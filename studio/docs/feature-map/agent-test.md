# Agent test

Five sentences a drone pilot would say, in Italian, each with the entry of the map that answers it. The coordinator
gives a fresh agent only this map and one sentence, and checks that it names the expected entry. Every answer is
unique in the map: the sentence contains the detail that separates it from the neighbouring entries.

| # | Sentence (Italian) | Expected file | Expected heading |
|---|---|---|---|
| 1 | Come rallento una clip che ho già messo sulla timeline? | `properties.md` | `Speed` |
| 2 | Come faccio a togliere l'audio di una clip e lasciarla muta? | `properties.md` | `Gain` |
| 3 | Come aggiungo una dissolvenza tra la fine di una clip e l'inizio della successiva? | `sidebar.md` | `Transitions` |
| 4 | Come scelgo la risoluzione dell'export, per esempio per esportare in 4K? | `export.md` | `Resolution` |
| 5 | Che scorciatoia da tastiera c'è per tagliare una clip nel punto in cui è fermo il cursore di riproduzione? | `menus-and-shortcuts.md` | `Split at playhead` |

Notes on the expected answers:

1. `Speed` is in the Video tab of the clip inspector (`properties.md`); the timeline's Rate Stretch Tool changes
   speed by dragging an edge, but the sentence asks for the numeric control.
2. `Gain` is the clip's volume in the Audio tab; at -60 dB the clip is silent. The preview's `Mute` only affects
   local playback and the timeline's `Disable track` silences a whole track, so neither answers this sentence.
3. `Transitions` in `sidebar.md` applies a transition to a cut; `Transition` in `properties.md` only edits one that
   already exists.
4. `Resolution` in the export dialog chooses the output size; `Same as project` keeps a 4K project at 4K.
5. `Split at playhead` is the keyboard command; `Split at cursor` cuts under the mouse, and the `Razor Tool` cuts
   where it is clicked.
