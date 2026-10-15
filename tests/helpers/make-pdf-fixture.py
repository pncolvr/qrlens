"""Generate the small vector-only QR PDF used by integration checks."""
from pathlib import Path
import zlib

root = Path(__file__).resolve().parent.parent
objects = []
def add(value):
    objects.append(value if isinstance(value, bytes) else value.encode())
    return len(objects)
def qr(name, left, top):
    _, width, height, *bits = (root / f'fixtures/{name}.pbm').read_text().split()
    width, height, module = int(width), int(height), 3
    return '\n'.join(f'{left + x*module} {500-top-(y+1)*module} {module} {module} re f' for y in range(height) for x in range(width) if bits[y*width+x]=='1')
add('<< /Type /Catalog /Pages 2 0 R >>')
add('<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>')
for content, rotation in [(qr('link',40,60),0),('',0),(qr('link',40,280)+'\n'+qr('text',250,60),90)]:
    stream = zlib.compress(('0 g\n'+content).encode())
    page_id = len(objects)+1
    add(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Rotate {rotation} /Resources << >> /Contents {page_id+1} 0 R >>')
    add(f'<< /Length {len(stream)} /Filter /FlateDecode >>\nstream\n'.encode()+stream+b'\nendstream')
data=bytearray(b'%PDF-1.7\n')
offsets=[0]
for number,obj in enumerate(objects,1):
    offsets.append(len(data));data.extend(f'{number} 0 obj\n'.encode()+obj+b'\nendobj\n')
xref=len(data)
data.extend(f'xref\n0 {len(offsets)}\n0000000000 65535 f \n'.encode())
for offset in offsets[1:]:data.extend(f'{offset:010d} 00000 n \n'.encode())
data.extend(f'trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode())
(root/'fixtures/pages.pdf').write_bytes(data)
