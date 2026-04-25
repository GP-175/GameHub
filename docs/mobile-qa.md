# GP-hoot Real Mobile QA

Use this checklist on real devices before treating GP-hoot as mobile-ready.

## Setup

- Mac and phones are on the same Wi-Fi.
- Server is running: `PORT=3001 npm start`.
- Host URL: `http://192.168.100.13:3001/gp-hoot`.
- Player URL format: `http://192.168.100.13:3001/gp-hoot?room=123456`.

If the phone cannot load the URL, check macOS Firewall and allow incoming connections for Node.

## Device Matrix

| Device | Browser | Result | Notes |
| --- | --- | --- | --- |
| iPhone | Safari | Not tested |  |
| iPhone | Chrome | Not tested |  |
| Android | Chrome | Not tested |  |

## Host Flow

- Open the host page using the LAN URL, not `localhost`.
- Sign up or log in.
- Create a quiz with at least two questions.
- Add one image question from the phone or Mac photo library.
- Save the quiz and confirm it appears in the quiz list after a refresh.
- Duplicate the quiz and confirm the copy appears.
- Delete the copy and confirm it disappears.
- Host the quiz with Auto-advance off.
- Confirm the room code is readable across the room.
- Confirm Copy code and Copy link work.
- Confirm QR scan opens the player join page on phones.

## Player Flow

- Join from Safari with the QR code.
- Join from Chrome with the QR code.
- Use nicknames between 3 and 20 characters.
- Confirm duplicate nickname is rejected while the first player is connected.
- Confirm player lobby updates when other players join.
- Confirm answer buttons are large enough for thumbs in portrait orientation.
- Confirm long answer text wraps without overlapping shapes or buttons.
- Submit an answer and confirm the screen locks.
- Rotate the phone briefly and return to portrait; confirm layout recovers.
- Background the browser for 10 seconds and return; confirm reconnect preserves score.

## Gameplay Controls

- Start the quiz from the host.
- Pause and confirm players cannot answer while paused.
- Resume and confirm players can answer.
- Skip a question and confirm results are shown.
- Kick one player and confirm they leave the room.
- End the game early and confirm final leaderboard appears.
- Run another room with Auto-advance on and confirm result screens advance after about 5 seconds.

## Pass Criteria

- No horizontal scrolling on phones.
- No text overlaps on question, result, or final screens.
- Timer and room code are readable.
- Tap targets feel reliable on Safari and Chrome.
- Reconnect preserves nickname and score within 60 seconds.
- Leaderboard order matches expected scores.
