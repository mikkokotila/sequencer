import zipfile, struct, json, os
from pathlib import Path
out=Path(__file__).parent
z=zipfile.ZipFile(os.environ.get('QC_ZIP','/private/tmp/sequencer-qc-twelve-phrases.zip'))
m=json.loads((out/'export-results.json').read_text())
r={'entries':len(z.namelist()),'crcFailure':z.testzip(),'files':[]}
for i,name in enumerate(z.namelist()):
    d=z.read(name)
    ch,sr,align,bits=struct.unpack_from('<HI4xHH',d,22)
    row={'name':name,'bytes':len(d),'channels':ch,'sampleRate':sr,'blockAlign':align,'bits':bits,'frames':struct.unpack_from('<I',d,40)[0]//align}
    assert name==f'phrase-{i+1:02d}.wav'
    assert ch==2 and bits==24 and align==6 and sr==m['sampleRate'] and row['frames']==m['frames']
    assert struct.unpack_from('<I',d,4)[0]+8==len(d)
    r['files'].append(row)
assert r['entries']==12 and r['crcFailure'] is None
r['status']='PASS'
(out/'export-independent-check.json').write_text(json.dumps(r,indent=2)+'\n')
print(json.dumps(r))
