# Token art

These two scripts turned four equipment-card scans into the token images in `assets/three-kingdoms/tokens/`. They are kept as the record of how those images were made. [docs/frontend.md](../../docs/frontend.md#tokens) describes the steps.

They are not part of the game or its tests, and nothing in the repository runs them.

## What is needed

Neither the inputs nor the models are in the repository.

- **Python 3** with `numpy`, `pillow`, `scipy`, `opencv-python` and `torch`.
- **Model weights** from the Real-ESRGAN releases, in one folder:
  - `RealESRGAN_x4plus.pth`
  - `RealESRGAN_x4plus_anime_6B.pth`
- **Source images**, in one folder, as `halberd.png`, `crossbow.png`, `axe.png` and `sword.png`.

## Running

```bash
python tools/token-art/build.py <models folder> <sources folder> <output folder>
```

For each weapon the output folder receives the token (`<name>.webp`, and `token-<name>.png` without compression), the enlarged card (`clean-<name>.png`), the outline used (`hull-<name>.png`), and one `sheet.png` showing all four on card paper for checking by eye.

Name one or more weapons after the three folders to rebuild only those.

## Changing the sources

The crop of each card and the outline around each weapon are written into `SPECS` at the top of `build.py`, in pixels of the source image. They fit the four scans that were used and nothing else. With a different scan, read the new coordinates off the image, update `SPECS`, and check `hull-<name>.png`: the red line should clear the weapon by a few pixels all the way round and stay off anything else on the card.
