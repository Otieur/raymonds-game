"""Upscale the source cards four times with Real-ESRGAN (RRDBNet), on this machine."""
import sys, time
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image


class ResidualDenseBlock(nn.Module):
    def __init__(self, num_feat=64, num_grow_ch=32):
        super().__init__()
        self.conv1 = nn.Conv2d(num_feat, num_grow_ch, 3, 1, 1)
        self.conv2 = nn.Conv2d(num_feat + num_grow_ch, num_grow_ch, 3, 1, 1)
        self.conv3 = nn.Conv2d(num_feat + 2 * num_grow_ch, num_grow_ch, 3, 1, 1)
        self.conv4 = nn.Conv2d(num_feat + 3 * num_grow_ch, num_grow_ch, 3, 1, 1)
        self.conv5 = nn.Conv2d(num_feat + 4 * num_grow_ch, num_feat, 3, 1, 1)
        self.lrelu = nn.LeakyReLU(negative_slope=0.2, inplace=True)

    def forward(self, x):
        x1 = self.lrelu(self.conv1(x))
        x2 = self.lrelu(self.conv2(torch.cat((x, x1), 1)))
        x3 = self.lrelu(self.conv3(torch.cat((x, x1, x2), 1)))
        x4 = self.lrelu(self.conv4(torch.cat((x, x1, x2, x3), 1)))
        x5 = self.conv5(torch.cat((x, x1, x2, x3, x4), 1))
        return x5 * 0.2 + x


class RRDB(nn.Module):
    def __init__(self, num_feat, num_grow_ch=32):
        super().__init__()
        self.rdb1 = ResidualDenseBlock(num_feat, num_grow_ch)
        self.rdb2 = ResidualDenseBlock(num_feat, num_grow_ch)
        self.rdb3 = ResidualDenseBlock(num_feat, num_grow_ch)

    def forward(self, x):
        return self.rdb3(self.rdb2(self.rdb1(x))) * 0.2 + x


class RRDBNet(nn.Module):
    def __init__(self, num_block, num_feat=64, num_grow_ch=32):
        super().__init__()
        self.conv_first = nn.Conv2d(3, num_feat, 3, 1, 1)
        self.body = nn.Sequential(*[RRDB(num_feat, num_grow_ch) for _ in range(num_block)])
        self.conv_body = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
        self.conv_up1 = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
        self.conv_up2 = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
        self.conv_hr = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
        self.conv_last = nn.Conv2d(num_feat, 3, 3, 1, 1)
        self.lrelu = nn.LeakyReLU(negative_slope=0.2, inplace=True)

    def forward(self, x):
        feat = self.conv_first(x)
        feat = feat + self.conv_body(self.body(feat))
        feat = self.lrelu(self.conv_up1(F.interpolate(feat, scale_factor=2, mode='nearest')))
        feat = self.lrelu(self.conv_up2(F.interpolate(feat, scale_factor=2, mode='nearest')))
        return self.conv_last(self.lrelu(self.conv_hr(feat)))


def load(path, blocks, device):
    state = torch.load(path, map_location='cpu', weights_only=True)
    state = state.get('params_ema', state.get('params', state))
    net = RRDBNet(blocks)
    net.load_state_dict(state, strict=True)
    return net.eval().to(device)


def upscale(net, image, device, pad=12):
    x = torch.from_numpy(np.asarray(image.convert('RGB'), dtype=np.float32) / 255).permute(2, 0, 1)[None]
    x = F.pad(x, (pad, pad, pad, pad), mode='reflect').to(device)
    with torch.no_grad():
        y = net(x).clamp(0, 1)[0].permute(1, 2, 0).cpu().numpy()
    y = y[pad * 4 : y.shape[0] - pad * 4, pad * 4 : y.shape[1] - pad * 4]
    return Image.fromarray((y * 255 + 0.5).astype(np.uint8))


if __name__ == '__main__':
    models, src, out = sys.argv[1:4]
    device = 'mps' if torch.backends.mps.is_available() else 'cpu'
    # The drawing on each card, with a margin: left, top, right, bottom.
    crops = {
        'halberd': (20, 40, 166, 162),
        'crossbow': (40, 70, 214, 214),
        'axe': (120, 170, 630, 630),
        'sword': (80, 0, 560, 360),
    }
    nets = {
        'general': load(f'{models}/RealESRGAN_x4plus.pth', 23, device),
        'anime': load(f'{models}/RealESRGAN_x4plus_anime_6B.pth', 6, device),
    }
    for name, box in crops.items():
        image = Image.open(f'{src}/{name}.png').convert('RGB').crop(box)
        for label, net in nets.items():
            started = time.time()
            result = upscale(net, image, device)
            result.save(f'{out}/sr-{name}-{label}.png')
            print(name, label, image.size, '->', result.size, f'{time.time() - started:.1f}s', flush=True)
