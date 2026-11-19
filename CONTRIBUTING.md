# Contributing

Thank you for helping. This repository is the published source of each DroneClean Studio release: it is written
from the development repository at every release, as one commit with its tag.

## Issues

[Open an issue](https://github.com/matteodante/droneclean-studio/issues/new/choose) for a bug or an idea. For a bug, the
template asks for the version, the platform, the steps, and the footage (camera, resolution, frame rate), which most
problems depend on. Please do not attach footage you do not want public.

## Pull requests

Pull requests are welcome. Because the repository is rewritten at each release, a pull request is not merged here:
it is reviewed, applied to the development repository with your authorship kept, and arrives in the next release.
Keep each one to a single change, with a test when it fixes a bug.

Before opening one, in `studio/`:

```sh
npm ci
npm run check:quick    # types, lint and the fast checks
npm run verify         # the full suite (needs Google Chrome and FFmpeg)
```

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org) (`fix(timeline): …`,
`feat(export): …`). New code goes in new files where it can, so the forks of FreeCut and Gyroflow stay easy to update.

## Licence

By contributing you agree that your contribution is licensed under GPL-3.0-or-later, as the rest of the project.
