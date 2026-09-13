import json,pathlib,math
p=pathlib.Path(__file__).resolve().parent
results=json.loads((p/'stress-results.json').read_text())
def stats(x):
 x=sorted(x)
 return dict(n=len(x),min=min(x) if x else None,median=x[int(len(x)*.5)] if x else None,p95=x[int(len(x)*.95)] if x else None,p99=x[int(len(x)*.99)] if x else None,max=max(x) if x else None)
for r in results:
 raw=json.loads((p/(r['name']+'.raw.json')).read_text());onsets=raw['onsets'];skews=[];missing=0
 for e in [x for x in onsets if x['track']==0]:
  pair=[]
  for t in range(1,9):
   matches=[x for x in onsets if x['track']==t and abs(x['time']-e['time'])<.03]
   if matches:pair.append(min(matches,key=lambda x:abs(x['time']-e['time'])))
  if len(pair)==8:skews.append(max(abs(x['time']-e['time'])*1000 for x in pair))
  else:missing+=1
 r['onsetTrackSkewMs']=stats(skews);r['unpairedOnsets']=missing
 r['postStopVisuals']=sum(any(v['epoch']==s['epoch'] and v['at']>s['at']+1/raw['sampleRate'] for s in raw['stops']) for v in raw['visuals'])
 r['observedTrack0Onsets']=len([x for x in onsets if x['track']==0])
 print(r['name'],'onset-skew-ms',r['onsetTrackSkewMs']['max'],'onsets',r['observedTrack0Onsets'],'steps',r['steps'],'post-stop-visuals',r['postStopVisuals'])
(p/'stress-results.json').write_text(json.dumps(results,indent=2)+'\n')
matrix=[]
for r in results:
 criteria={
  'no_missed_source_deadline_over_1ms':r['lateSources']==0,
  'source_event_sequence_and_track_coverage':r['sequenceErrors']==0 and r['missingTracks']==0,
  'inter_track_onsets_within_one_sample':r['onsetTrackSkewMs']['max']<=1000/44100,
  'visual_p99_within_30ms_of_render_clock':abs(r['visualErrorMs']['p99'])<=30,
  'median_visual_within_30ms_of_estimated_output':abs(r['estimatedOutputLeadMs']['median'])<=30,
  'phrase_marker_within_30ms_of_next_phrase':all(b['leadMs'] is not None and abs(b['leadMs'])<=30 for b in r['boundaries']),
  'stop_cleanup':r['aliveAfterStop']==0 and r['litAfterStop']==0 and r['markedAfterStop']==0 and r['postStopVisuals']==0,
 }
 matrix.append({'scenario':r['name'],'verdict':'PASS' if all(criteria.values()) else 'FAIL','checks':{k:'PASS' if v else 'FAIL' for k,v in criteria.items()}})
(p/'runtime-checks.json').write_text(json.dumps(matrix,indent=2)+'\n')
