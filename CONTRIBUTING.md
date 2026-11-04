# Contributing

Thanks for wanting to help the cat misbehave better. Bug reports, ideas and pull requests are all welcome.

## Before you open a pull request

```bash
npm install
npm test
npm run typecheck
npm run check:forbidden
```

All four should pass. If you touch the Rust side, `cd src-tauri && cargo build` should still work too.

A few things the project will never take, whatever the reason:

- Code that fakes input: key presses, clicks, scrolls or moving the cursor. The cat can look like it's walking on your keyboard, but it never touches it. `npm run check:forbidden` and CI check this.
- Screenshots or screen capture of any kind.
- Anything that closes, hides, moves or resizes other apps' windows.
- Network calls, analytics or telemetry. The only network the app knows is the local model on `localhost`.
- Window titles or personal data in the default logs.

If a behavior changes, update `docs/behavior-catalog.md` in the same pull request.

## Licensing of your contribution

Felinquent is source available, free for non-commercial use. The code is under the PolyForm Noncommercial License 1.0.0 (`LICENSE`) and the art under CC BY-NC 4.0 (`LICENSE-ART.md`).

By opening a pull request or otherwise sending a contribution, you agree to this:

1. You wrote it yourself, or you have the right to send it under these terms.
2. You keep your copyright.
3. You give Abozar Alizadeh a perpetual, worldwide, non-exclusive, royalty-free, irrevocable license to use, copy, change, distribute, sublicense and relicense your contribution, under the project's current licenses or any other terms, including commercial ones. This lets the project change its license later, or offer a commercial license, without having to track everyone down.
4. You give the same patent rights for your contribution that `LICENSE` asks of the licensor.

If you can't agree to that (your employer owns your code, for example), please say so in the pull request before it gets merged.
