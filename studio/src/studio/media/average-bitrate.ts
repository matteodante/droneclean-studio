/**
 * Average bitrate of a media file in bits per second: `fileSize x 8 / duration`.
 * It includes the audio and the container overhead (the file's own average, not
 * the video stream's). 0 when the size or duration is unknown, which is what the
 * export dialog reads as "no source bitrate".
 */
export function computeAverageBitrate(
  fileSizeBytes: number | null | undefined,
  durationSeconds: number,
): number {
  if (!fileSizeBytes || !Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) return 0
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0
  return Math.round((fileSizeBytes * 8) / durationSeconds)
}
