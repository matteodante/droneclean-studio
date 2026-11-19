// Media-library-local adapter for workspace-backed storage APIs.
//
// Keep direct workspace-fs imports out of media-library services; this facade is
// intentionally thin and behavior-preserving.
export {
  associateMediaWithProject,
  createMedia,
  decrementContentRef,
  deleteCaptions,
  deleteContent,
  deleteMedia,
  deleteScenes,
  deleteThumbnailsByMediaId,
  deleteTranscript,
  getAllMedia,
  getAllMediaMetadata,
  getMedia,
  getMediaForProject,
  getProjectMediaIds,
  getProjectsUsingMedia,
  getThumbnailByMediaId,
  getThumbnailsByMediaIds,
  hasMediaSource,
  incrementContentRef,
  mirrorBlobToWorkspace,
  mirrorJsonToWorkspace,
  proxyDir,
  proxyFilePath,
  proxyMetaPath,
  readAiOutput,
  readMediaSource,
  readWorkspaceBlob,
  removeMediaBatchFromProject,
  removeMediaFromProject,
  removeWorkspaceCacheEntry,
  saveCaptions,
  saveThumbnail,
  updateMedia,
  writeMediaSource,
} from '@/infrastructure/storage'

// Linked-media descriptor: written next to `media/{id}/metadata.json` so the
// workspace folder says which external file a media points at. The storage
// barrel predates the descriptor, so it is imported from its module directly.
export {
  writeMediaSourceLink,
  type MediaSourceLink,
} from '@/infrastructure/storage/workspace-fs/media-source'
