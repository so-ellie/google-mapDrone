# google-mapDrone
Control a “drone” on Google Maps using 7 MediaPipe hand gestures (JS-only, webcam + Maps JS API). No frameworks, no build step.

# how to run
1. put your Maps API key in 'index.html'
2. start a server in the project folder:
   '''bash
   python -m http.server
3. open http://localhost:8000
4. click start camera -> allow permission -> show hand gestures to move the drone

# controls
| Gesture      | Action                            |
| ------------ | --------------------------------- |
| Open\_Palm   | Enable controls                   |
| Closed\_Fist | Stop & disable                    |
| Pointing\_Up | Auto-forward (until Closed\_Fist) |
| Thumb\_Up    | Step forward                      |
| Thumb\_Down  | Step back                         |
| ILoveYou     | Turn left (10°)                   |
| Victory      | Turn right (10°)                  |

*ILoveYou - rock&roll sign with a thumb up



