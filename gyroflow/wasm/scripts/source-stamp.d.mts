export const GYRO_DIR: string
export const STAMP_FILE: string
export const SOURCE_GLOBS: string[]
export function filesUnder(path: string): string[]
export function gyroSourceStamp(repoRoot: string): string
export function writeGyroSourceStamp(repoRoot: string, stamp?: string): string
