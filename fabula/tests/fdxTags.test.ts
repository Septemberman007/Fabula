import { describe, expect, it } from 'vitest';
import { exportFdx, importFdx } from '../src/io';
import { breakdown, ensureProduction, tagText, toggleInScene } from '../src/production';
import { scenes } from '../src/stats';

/** Malý dokument ve tvaru, jak tagy zapisuje Final Draft. */
const FDX = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<FinalDraft DocumentType="Script" Template="No" Version="6">
  <Content>
    <Paragraph Number="1" Type="Scene Heading"><Text>INT. KUCHYNĚ – DEN</Text></Paragraph>
    <Paragraph Type="Action"><Text>Eva vezme </Text><Text TagNumber="1">nůž</Text><Text> a </Text><Text TagNumber="2">pes</Text><Text> zaštěká.</Text></Paragraph>
    <Paragraph Number="2" Type="Scene Heading"><Text>EXT. DVŮR – NOC</Text></Paragraph>
    <Paragraph Type="Action"><Text>Nůž leží v trávě. Pes spí.</Text></Paragraph>
    <Paragraph Type="Action"><Text TagNumber="3">Starý</Text><Text TagNumber="3" Style="Bold"> traktor</Text><Text> stojí u vrat.</Text></Paragraph>
  </Content>
  <TagData>
    <TagCategories>
      <TagCategory Color="#940011000000" Id="05c556eb-6bc1-4a3a-b09f-f8b5ba1b6afa" Name="Props" Number="6" Style="Bold"/>
      <TagCategory Color="#940011000000" Id="09cb0d1c-ce01-4f22-bb64-b5f2e6c491c6" Name="Animals" Number="11" Style="Bold"/>
      <TagCategory Color="#0000FFFF0000" Id="aaaaaaaa-0000-0000-0000-000000000001" Name="Pyrotechnics" Number="30" Style="Bold"/>
    </TagCategories>
    <TagDefinitions>
      <TagDefinition CatId="05c556eb-6bc1-4a3a-b09f-f8b5ba1b6afa" Id="d1" Label="kuchyňský nůž" Number="1"/>
      <TagDefinition CatId="09cb0d1c-ce01-4f22-bb64-b5f2e6c491c6" Id="d2" Label="pes" Number="2"/>
      <TagDefinition CatId="aaaaaaaa-0000-0000-0000-000000000001" Id="d3" Label="starý traktor" Number="3"/>
      <TagDefinition CatId="05c556eb-6bc1-4a3a-b09f-f8b5ba1b6afa" Id="d4" Label="nepoužitý" Number="4"/>
    </TagDefinitions>
    <Tags>
      <Tag Number="1"><DefId>d1</DefId></Tag>
      <Tag Number="2"><DefId>d2</DefId></Tag>
      <Tag Number="3"><DefId>d3</DefId><DefId>d1</DefId></Tag>
    </Tags>
  </TagData>
</FinalDraft>`;

const names = (p: ReturnType<typeof importFdx>, n: number) =>
  [...breakdown(p).find((x) => x.scene.n === n)!.elements.values()].flat().map((x) => x.el.name).sort();

describe('tagy Final Draftu', () => {
  it('import: kategorie, prvky, tvary a scény přesně podle otagování', () => {
    const p = importFdx(FDX, 'test.fdx');
    const prod = p.production!;
    expect(prod.elements.map((e) => e.name).sort()).toEqual(['kuchyňský nůž', 'pes', 'starý traktor']);
    const cat = (name: string) => prod.categories.find((c) => c.name === name)!;
    expect(prod.elements.find((e) => e.name === 'pes')!.categoryId).toBe(cat('Zvířata').id);
    expect(cat('Pyrotechnics').color).toBe('#00ff00');
    expect(prod.elements.find((e) => e.name === 'kuchyňský nůž')!.aliases).toBe('nůž, Starý traktor');
    // „Nůž“ a „pes“ ve druhé scéně otagované nebyly, nůž je tam ale přes víceprvkový tag 3.
    expect(names(p, 1)).toEqual(['kuchyňský nůž', 'pes']);
    expect(names(p, 2)).toEqual(['kuchyňský nůž', 'starý traktor']);
  });

  it('export a zpětný import zachová rozpis', () => {
    const p = importFdx(FDX, 'test.fdx');
    const out = exportFdx(p);
    expect(out).toContain('<TagData>');
    expect(out).toContain('Name="Props"');
    expect(out).toMatch(/<Text TagNumber="\d+">nůž<\/Text>/);
    const back = importFdx(out, 'zpět.fdx');
    expect(names(back, 1)).toEqual(names(p, 1));
    expect(names(back, 2)).toEqual(names(p, 2));
  });

  it('ručně přidaný prvek se otaguje na hlavičce, vyřazený se neotaguje', () => {
    const p = importFdx(FDX, 'test.fdx');
    p.production = undefined;
    const prod = ensureProduction(p);
    const props = prod.categories.find((c) => c.name === 'Rekvizity')!.id;
    const gun = tagText(p, 'nůž', props)!;
    const lamp = tagText(p, 'lucerna', props)!;
    const sc = scenes(p);
    toggleInScene(p, gun, sc[1].id, sc);
    toggleInScene(p, lamp, sc[1].id, sc);
    const out = exportFdx(p);
    expect(out).toMatch(/<Text TagNumber="\d+">EXT\. DVŮR – NOC<\/Text>/);
    expect(out).not.toMatch(/TagNumber="\d+">Nůž/);
    const back = importFdx(out, 'zpět.fdx');
    expect(names(back, 1)).toEqual(['nůž']);
    expect(names(back, 2)).toEqual(['lucerna']);
  });

  it('bez produkčních prvků export TagData nepřidá', () => {
    const p = importFdx(FDX, 'test.fdx');
    p.production = undefined;
    expect(exportFdx(p)).not.toContain('TagData');
  });
});
