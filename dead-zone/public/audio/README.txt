DEAD ZONE soundtrack drop-in folder
===================================

The game ships with a procedural dark-ambient loop and synthesized SFX, so it
is fully playable with this folder empty.

To use the real DEAD ZONE soundtrack from your Mac
(Desktop/DEAD ZONE - Found Files/DEAD_ZONE_SOUNDTRACK):

1. Copy the mp3 files into this folder.
2. Create playlist.json here listing them in play order, e.g.:

   ["dead_sector.mp3", "grave_circuit.mp3", "graveyard.mp3"]

The game fetches /audio/playlist.json on first click; if it exists the tracks
cycle forever, otherwise the procedural ambient loop plays.
