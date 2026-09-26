"""Generate responsive screenshot crops with cwebp; keep original PNGs intact."""
from pathlib import Path
import subprocess
root = Path(__file__).resolve().parents[1] / 'public' / 'features'
variants = [
 ('connections', 'connections', (1220,200,1160,1100), (580,1160)),
 ('ai-review', 'ai-review', (1750,80,930,1210), (465,930)),
 ('formatting', 'formatting', (2680,0,920,1160), (460,920)),
 ('themes', 'themes', (2680,0,920,950), (460,920)),
 ('workspace', 'row-details', (0,0,3600,1500), (800,1600,2400)),
 ('record-inspector', 'row-details', (1800,100,1800,1250), (600,1200,1800)),
 ('record-social', 'row-details', (0,0,3600,1890), (1200,)),
]
for name,source,crop,widths in variants:
 for width in widths:
  subprocess.run(['cwebp','-quiet','-lossless','-m','6','-crop',*map(str,crop),'-resize',str(width),'0',str(root/f'{source}.png'),'-o',str(root/f'{name}-{width}.webp')],check=True)
