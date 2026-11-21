import { memo, useRef } from 'react';
import { Beat } from './model';
import { BeatParas, ElementBar, useSurface } from './Surface';

/**
 * Editor textu jednoho beatu (panel vedle tabule). `sceneBase` je počet scén před tímto beatem.
 * Ve scénáři se nepoužívá: tam tvoří jednu společnou plochu všechny beaty dohromady.
 */
export const BeatEditor = memo(function BeatEditor({ beat, sceneBase }: { beat: Beat; sceneBase: number }) {
  const root = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const sf = useSurface(root, wrap, false);
  return (
    <div className="beat-editor" ref={wrap} {...sf.focus}>
      <div className="el-bar-row" contentEditable={false}>
        <ElementBar type={sf.curType} onSet={sf.setTypeSel} />
      </div>
      <div key={sf.epoch} ref={root} className="surface" data-beat-root={beat.id} {...sf.host}>
        <BeatParas beat={beat} sceneBase={sceneBase} cur={sf.cur?.paraId ?? null} noteOpen={sf.noteOpen} onNoteClose={sf.setNoteOpen} />
      </div>
      {sf.overlay}
    </div>
  );
});
