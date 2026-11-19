/**
 * The side-work scheduler the app uses: one instance, its lanes sized for this machine, held while the pilot plays or
 * exports. Producers (the filmstrip, proxy, waveform and post-import queues) ask it for their width and, where they
 * can, run their jobs through it.
 */
import { cpuLaneWidth, decodeLaneWidth, motionLaneWidth, SideWorkScheduler } from './scheduler'
import { probeEngineLanes } from './engine-probe'
import { startActivityHolds } from './activity-holds'

function machine(): { cores: number; memoryGb: number } {
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  const cores = nav?.hardwareConcurrency || 4
  // No bridge of the desktop shell tells the page the machine's memory, so this is Chrome's `deviceMemory`, which
  // Chrome rounds and caps (at 8 on most builds): the motion lane is then 1 wide on a 16 GB Mac at worst, never wider.
  // Chrome reports at most 8 here; the width of the cpu lane is the tighter of cores and memory, so a cap is safe.
  const memoryGb = (nav as (Navigator & { deviceMemory?: number }) | undefined)?.deviceMemory ?? 4
  return { cores, memoryGb }
}

let instance: SideWorkScheduler | null = null

/** The app's scheduler. The first call sizes the lanes; the engine probe starts then (cached after the first run). */
export function getSideWork(): SideWorkScheduler {
  if (instance) return instance
  const { cores, memoryGb } = machine()
  const scheduler = new SideWorkScheduler({
    transcode: 1,
    decode: decodeLaneWidth(cores),
    cpu: cpuLaneWidth(cores, memoryGb),
    motion: motionLaneWidth(memoryGb),
  })
  instance = scheduler
  void probeEngineLanes().then((probe) => {
    scheduler.setWidth('transcode', probe.transcode)
  })
  startActivityHolds(scheduler)
  return scheduler
}
