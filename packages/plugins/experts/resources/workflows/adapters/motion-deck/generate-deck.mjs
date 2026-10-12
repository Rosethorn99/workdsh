import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const assetRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const templatePath = fileURLToPath(new URL('../../fufan-ppt-office/preset/runtime/motion-deck/source/deck-template.html', import.meta.url));
const themes = ['ocean', 'airlab', 'swiss', 'gallery'];
const themeNames = { ocean: '深海指挥舱', airlab: '晴空研究所', swiss: '瑞士编辑', gallery: '午夜美术馆' };
const focuses = ['plugin', 'human', 'result'];
const focusNames = { plugin: '方法结构', human: '用户参与', result: '成果证据' };
const motions = ['title-bridge', 'split-contract', 'orbit-assembly', 'pipeline-run', 'constellation-bind', 'decision-flip', 'fan-results', 'converge-mark'];
const ambients = ['grid-breathe', 'status-cruise', 'triple-orbit', 'settled-beacon', 'magnetic-drift', 'selection-pulse', 'result-halo', 'cta-flow'];

function parseArgs(argv) {
  const [command = 'help', ...rest] = argv;
  const values = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    if (!key.startsWith('--')) continue;
    const value = rest[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${key} 缺少值`);
    values[key.slice(2)] = value;
    index += 1;
  }
  return values;
}

function escapeHtml(value = '') {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function short(value, max = 34) {
  const text = String(value ?? '').trim();
  return escapeHtml(text.length > max ? `${text.slice(0, max - 1)}…` : text);
}

function point(slide, index) {
  const points = Array.isArray(slide.points) && slide.points.length ? slide.points : [slide.summary];
  return short(points[index % points.length] ?? slide.summary ?? slide.title, 38);
}

function titleWords(title) {
  const text = String(title).trim();
  const chunks = text.split(/[，,:：｜|]/).map((item) => item.trim()).filter(Boolean);
  if (chunks.length > 1) return chunks.slice(0, 3);
  const split = Math.max(2, Math.ceil(text.length / 2));
  return [text.slice(0, split), text.slice(split)].filter(Boolean);
}

function attrs(slide, index) {
  return `data-page="${String(index + 1).padStart(2, '0')}" data-title="${escapeHtml(slide.title)}" data-section="${escapeHtml(slide.section)}" data-motion="${motions[index]}" data-ambient="${ambients[index]}" aria-hidden="true"`;
}

function buildSlide(slide, index, deck, sourceSection) {
  const a = attrs(slide, index);
  const brand = short(deck.brand || deck.title, 18);
  if (index === 0) {
    return `    <section class="slide cover" ${a}>
      <div class="ambient-grid" aria-hidden="true"></div><div class="content"><div class="cover-copy">
        <p class="eyebrow" data-motion-item="tag">${short(deck.eyebrow || 'MOTION STORY', 34)}</p>
        <h1 aria-label="${escapeHtml(slide.title)}">${titleWords(slide.title).map((word, wordIndex) => `<span class="title-word${wordIndex === 1 ? ' accent-text' : ''}" data-motion-item="word">${escapeHtml(word)}</span>`).join('<br>')}</h1>
        <p class="lede" data-motion-item="copy">${short(slide.summary, 88)}</p>
        <div class="cover-caption" data-motion-item="caption"><span>${point(slide, 0)}</span><i></i><span>${point(slide, 1)}</span><i></i><span>${point(slide, 2)}</span></div>
      </div><div class="task-core"><div class="core-orbit" data-motion-item="ring"></div><div class="bridge-line" data-motion-item="bridge"></div>
        <span class="task-label need" data-motion-item="need">${point(slide, 0)}</span><div class="core" data-motion-item="core">${brand}</div><span class="task-label result" data-motion-item="result">${point(slide, 2)}</span>
        <div class="core-note" data-motion-item="caption"><span>${point(slide, 0)}</span><span>${point(slide, 1)}</span><span>${point(slide, 2)}</span></div>
      </div></div>
    </section>`;
  }
  if (index === 1) {
    return `    <section class="slide" ${a}><div class="content compare-layout"><div class="compare-col">
      <p class="eyebrow" data-motion-item="left">BEFORE</p><h2 data-motion-item="left">${short(slide.title, 26)}</h2>
      <div class="chat-stack"><div class="chat-bubble" data-motion-item="chat">${point(slide, 0)}</div><div class="chat-bubble" data-motion-item="chat">${point(slide, 1)}</div><div class="chat-bubble" data-motion-item="chat">${point(slide, 2)}</div></div>
      <div class="answer-label" data-motion-item="left">${short(slide.summary, 54)}</div></div><div class="split-line" data-motion-item="divider"></div><div class="compare-col">
      <p class="eyebrow" data-motion-item="right">AFTER</p><h2 data-motion-item="right"><span class="accent-text">变化正在发生。</span></h2><div class="action-stack">
      ${[0, 1, 2, 3].map((i) => `<div class="action-row panel" data-motion-item="action"><span class="action-icon">0${i + 1}</span><span class="action-name" style="grid-column:2 / 4">${point(slide, i)}</span><span class="action-state">→</span></div>`).join('')}</div></div></div></section>`;
  }
  if (index === 2) {
    return `    <section class="slide" ${a}><div class="content assembly-layout"><div class="assembly-copy"><p class="eyebrow" data-motion-item="copy">SYSTEM</p><h2 data-motion-item="copy">${short(slide.title, 30)}</h2><p class="lede" data-motion-item="copy">${short(slide.summary, 78)}</p><div class="assembly-note">${[0,1,2].map((i) => `<div data-motion-item="note"><b>0${i + 1}</b>${point(slide, i)}</div>`).join('')}</div></div><div class="assembly-stage"><div class="orbit-layer outer" data-motion-item="ring"></div><div class="orbit-layer middle" data-motion-item="ring"></div><div class="orbit-layer inner" data-motion-item="ring"></div><div class="assembly-core" data-motion-item="core">${brand}</div><div class="assembly-node skill" data-motion-item="node">${point(slide,0)}</div><div class="assembly-node preset" data-motion-item="node">${point(slide,1)}</div><div class="assembly-node tools" data-motion-item="node">${point(slide,2)}</div></div></div></section>`;
  }
  if (index === 3) {
    return `    <section class="slide" ${a}><div class="content pipeline-layout"><div class="pipeline-head"><div><p class="eyebrow" data-motion-item="copy">FLOW</p><h2 data-motion-item="copy">${short(slide.title, 30)}</h2></div><p class="lede" data-motion-item="copy">${short(slide.summary, 72)}</p></div><div class="pipeline-stage"><div class="pipeline-track" data-motion-item="track"></div><div class="run-beacon" data-motion-item="beacon"></div><div class="pipeline-grid">${[0,1,2,3,4].map((i) => `<article class="station panel" data-motion-item="station"><span class="station-index">0${i + 1}</span><h3>${point(slide,i)}</h3></article>`).join('')}</div><div class="console-log"><div class="console-window" data-motion-item="console"><p><span class="prompt">$</span> ${short(deck.title, 30)}</p><p><span class="ok">[OK]</span> ${point(slide,0)}</p><p><span class="ok">[OK]</span> ${point(slide,1)}</p></div><div class="output-ticket panel" data-motion-item="output"><div class="output-icon">✓</div><div><span class="status-pill">VISIBLE</span><h3>${point(slide,2)}</h3></div></div></div></div></div></section>`;
  }
  if (index === 4) {
    return `    <section class="slide" ${a}><div class="content constellation-layout"><div class="constellation-copy"><p class="eyebrow" data-motion-item="copy">NETWORK</p><h2 data-motion-item="copy">${short(slide.title, 30)}</h2><p class="lede" data-motion-item="copy">${short(slide.summary, 74)}</p><div class="plugin-legend">${[0,1,2].map((i) => `<div data-motion-item="legend"><i></i><span>${point(slide,i)}</span></div>`).join('')}</div></div><div class="constellation-stage"><svg class="constellation-lines" viewBox="0 0 800 690"><line x1="400" y1="345" x2="139" y2="113" data-motion-item="line"/><line x1="400" y1="345" x2="670" y2="120" data-motion-item="line"/><line x1="400" y1="345" x2="724" y2="353" data-motion-item="line"/><line x1="400" y1="345" x2="613" y2="595" data-motion-item="line"/><line x1="400" y1="345" x2="153" y2="582" data-motion-item="line"/><line x1="400" y1="345" x2="72" y2="348" data-motion-item="line"/></svg><div class="plugin-core" data-motion-item="core">${brand}</div>${[["n1",130,100],["n2",-120,95],["n3",-150,0],["n4",-100,-120],["n5",120,-110],["n6",150,0]].map(([klass,x,y],i) => `<div class="plugin-node ${klass}" data-motion-item="plugin" data-from-x="${x}" data-from-y="${y}">${point(slide,i)}</div>`).join('')}</div></div></section>`;
  }
  if (index === 5) {
    // Keep the original interactive scene, its controls, ids and animation targets.
    return sourceSection.replace(/<section[^>]*>/, `<section class="slide" ${a}>`)
      .replace(/<div class="decision-head">[\s\S]*?<\/div>/, `<div class="decision-head"><p class="eyebrow" data-motion-item="copy">CHOICE</p><h2 data-motion-item="copy">${short(slide.title,30)}</h2><p class="lede" data-motion-item="copy" style="font-size:16px;margin-top:12px">${short(slide.summary,70)}</p></div>`);
  }
  if (index === 6) {
    return `    <section class="slide" ${a}><div class="content results-layout"><p class="eyebrow" data-motion-item="copy" style="justify-content:center">RESULTS</p><h2 data-motion-item="copy">${short(slide.title, 34)}</h2><p class="lede" data-motion-item="copy">${short(slide.summary, 78)}</p><div class="results-halo" aria-hidden="true"></div><div class="result-fan">${[[420,-13],[210,-7],[0,0],[-210,7],[-420,13]].map(([x,r],i) => `<article class="result-card panel" data-motion-item="result" data-fan-x="${x}" data-fan-r="${r}"><span class="result-number">0${i+1}</span><div class="result-icon">${i+1}</div><h3>${point(slide,i)}</h3><p>${short(slide.summary,48)}</p></article>`).join('')}</div></div></section>`;
  }
  return `    <section class="slide final-slide" ${a}><div class="ambient-final"></div><div class="content final-layout"><div class="converge-stage"><div class="converge-icon i1" data-motion-item="icon" data-from-x="-240" data-from-y="-120">${point(slide,0)}</div><div class="converge-icon i3" data-motion-item="icon" data-from-x="0" data-from-y="-180">${point(slide,1)}</div><div class="converge-icon i5" data-motion-item="icon" data-from-x="240" data-from-y="-120">${point(slide,2)}</div><div class="final-mark" data-motion-item="mark"><span>${brand}</span></div></div><p class="eyebrow" data-motion-item="copy">${short(deck.eyebrow || 'ONE MORE RESULT',32)}</p><h2 data-motion-item="title">${short(slide.title,36)}</h2><p class="lede" data-motion-item="copy">${short(slide.summary,80)}</p><div class="final-cta" data-motion-item="cta"><span>${short(deck.cta || point(slide,2),32)}</span><span>→</span></div><div class="final-foot" data-motion-item="copy">${short(deck.footer || deck.brand,60)}</div></div></section>`;
}

async function loadProject(caseRoot, projectArg) {
  if (!projectArg) throw new Error('必须提供 --project');
  const project = resolve(caseRoot, projectArg);
  const rel = relative(caseRoot, project).replaceAll('\\', '/');
  if (rel.startsWith('..') || rel === '' || !rel.startsWith(`generated/`)) throw new Error('项目必须位于案例根目录 generated/<name>/');
  const outlinePath = resolve(project, 'input/outline.json');
  const outline = JSON.parse(await readFile(outlinePath, 'utf8'));
  if (!outline.deck?.title || !outline.deck?.brand) throw new Error('outline.deck.title 与 outline.deck.brand 必填');
  if (!Array.isArray(outline.slides) || outline.slides.length !== 8) throw new Error('outline.slides 必须恰好 8 页');
  outline.slides.forEach((slide, index) => {
    if (!slide.section || !slide.title || !slide.summary) throw new Error(`slides[${index}] 缺少 section/title/summary`);
    if (!Array.isArray(slide.points) || slide.points.length < 3) throw new Error(`slides[${index}].points 至少 3 项`);
  });
  return { project, outline };
}

async function renderProject(caseRoot, projectArg, theme, focus) {
  const { project, outline } = await loadProject(caseRoot, projectArg);
  if (!themes.includes(theme)) throw new Error(`不支持的模板：${theme}`);
  if (!focuses.includes(focus)) throw new Error(`不支持的叙事重点：${focus}`);
  let html = await readFile(templatePath, 'utf8');
  const sourceSections = [...html.matchAll(/^    <section class="slide[\s\S]*?^    <\/section>/gm)].map(match => match[0]);
  const sections = outline.slides.map((slide, index) => buildSlide(slide, index, outline.deck, sourceSections[index]));
  let sectionIndex = 0;
  html = html.replace(/^    <section class="slide[\s\S]*?^    <\/section>/gm, () => sections[sectionIndex++] ?? '');
  if (sectionIndex !== 8) throw new Error(`模板只替换了 ${sectionIndex}/8 页`);
  const decision = JSON.stringify({ theme, focus, generated: true, title: outline.deck.title, previewCopy: Object.fromEntries(focuses.map((value,index) => [value, [outline.deck.eyebrow || outline.deck.title, escapeHtml(outline.slides[5].title), outline.slides[5].points[index]]])) }).replaceAll('<', '\\u003c');
  html = html.replace(/<html lang="zh-CN" data-theme="[^"]+"(?: data-focus="[^"]+")?>/, `<html lang="zh-CN" data-theme="${theme}" data-focus="${focus}">`);
  html = html.replace(/<script id="generatedDecision" type="application\/json">[\s\S]*?<\/script>/, `<script id="generatedDecision" type="application/json">${decision}</script>`);
  html = html.replace(/data-preview-theme="[^"]+" data-preview-focus="[^"]+"/, 'data-preview-theme="' + theme + '" data-preview-focus="' + focus + '"');
  html = html.replace(/<div class="choice-set" data-preview-control="(theme|focus)">([\s\S]*?)<\/div>/g, (_match, kind, controls) => {
    const value = kind === 'theme' ? theme : focus;
    const cleared = controls.replace(/class="decision-choice(?: is-selected)?"/g, 'class="decision-choice"');
    return '<div class="choice-set" data-preview-control="' + kind + '">' + cleared.replace(new RegExp('class="decision-choice"([^>]*data-value="' + value + '")'), 'class="decision-choice is-selected"$1') + '</div>';
  });
  html = html.replace(/(<small id="previewKicker">)[\s\S]*?(<\/small>)/, '$1' + escapeHtml(outline.deck.eyebrow || outline.deck.title) + '$2');
  html = html.replace(/(<h3 id="previewTitle">)[\s\S]*?(<\/h3>)/, '$1' + escapeHtml(outline.slides[5].title) + '$2');
  html = html.replace(/(<p id="previewText">)[\s\S]*?(<\/p>)/, '$1' + escapeHtml(outline.slides[5].points[focuses.indexOf(focus)]) + '$2');
  html = html.replace('const previewCopy = {', 'const previewCopy = generatedDecision.previewCopy || {');
  html = html.replace('      fitDeck();', '      previewStage.dataset.previewTheme = generatedDecision.theme;\n      previewStage.dataset.previewFocus = generatedDecision.focus;\n      updatePreview();\n      fitDeck();');
  html = html.replaceAll('DeepSeek Harness', escapeHtml(outline.deck.brand));
  html = html.replaceAll('DEEPSEEK HARNESS', escapeHtml(String(outline.deck.brand).toUpperCase()));
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(outline.deck.title)}</title>`);
  html = html.replace(/<main class="viewport" id="deck" aria-label="[^"]+">/, `<main class="viewport" id="deck" aria-label="${escapeHtml(outline.deck.title)}">`);
  html = html.replace(/<div class="brand"><span class="brand-mark" aria-hidden="true"><\/span><span>[^<]+<\/span><\/div>/, `<div class="brand"><span class="brand-mark" aria-hidden="true"></span><span>${escapeHtml(outline.deck.brand)}</span></div>`);
  // Keep scene placement throughout entry motion and its cancellation boundary.
  // Source keyframes repeat absolute centering; use the computed anchor exactly once.
  html = html.replace('const animation = item.animate(frames,', `const baseTransform = getComputedStyle(item).transform;
        const finalTransform = frames[frames.length - 1].transform || '';
        const layoutAnchors = ['translate(-50%, -50%)', 'rotate(45deg)'].filter(anchor => finalTransform.includes(anchor));
        frames = frames.map((frame, index) => {
          if (!frame.transform) return frame;
          let relative = frame.transform;
          layoutAnchors.forEach(anchor => { relative = relative.replace(anchor, '').trim(); });
          return { ...frame, transform: index === frames.length - 1 ? baseTransform : (baseTransform === 'none' ? '' : baseTransform + ' ') + relative };
        });
        const animation = item.animate(frames,`);
  // Paragraph-sized closing labels need bounded boxes; the source uses short Skill/Preset/Plugin labels.
  html = html.replace('</head>', '<style id="generated-content-fit">:root[data-theme="airlab"] .action-row:nth-child(even),:root[data-theme="airlab"] .station:nth-child(even){transform:none}.core,.assembly-core,.plugin-core,.final-mark{text-align:center;overflow-wrap:normal}.core-note{left:0;right:0;margin:0 auto;transform:none;width:500px;max-width:calc(100% - 24px);line-height:1.4;text-align:center}.core-note span{flex:1;min-width:0;overflow-wrap:anywhere}.task-label{max-width:150px;line-height:1.35;overflow-wrap:anywhere}:root[data-theme="gallery"] .core-note{bottom:-40px}.final-mark span{font-size:' + (String(outline.deck.brand).length > 8 ? 12 : 21) + 'px;line-height:1.2}.converge-icon{width:144px;min-height:66px;padding:8px;font-size:12px;line-height:1.35;text-align:center}.converge-icon.i1{left:-18px}.converge-icon.i3{left:163px}.converge-icon.i5{right:-18px}' + (String(outline.deck.brand).length > 8 ? '.core,.assembly-core,.plugin-core{font-size:20px}' : '') + '</style></head>');
  const navLabels = outline.slides.map((slide, index) => `<button class="nav-dot" type="button" aria-label="第 ${index + 1} 页：${escapeHtml(slide.title)}"></button>`).join('\n      ');
  html = html.replace(/<button class="nav-dot"[^>]*><\/button>(?:\s*<button class="nav-dot"[^>]*><\/button>)*/g, navLabels);
  await mkdir(resolve(project, 'output'), { recursive: true });
  const output = resolve(project, 'output/index.html');
  await writeFile(output, html, 'utf8');
  await writeFile(resolve(project, 'input/decision.json'), `${JSON.stringify({ confirmed: true, theme, themeName: themeNames[theme], focus, focusName: focusNames[focus] }, null, 2)}\n`, 'utf8');
  return verifyProject(caseRoot, projectArg, { theme, focus });
}

async function verifyProject(caseRoot, projectArg, expected = {}) {
  const { project, outline } = await loadProject(caseRoot, projectArg);
  let decision = expected;
  if (!decision.theme || !decision.focus) {
    decision = JSON.parse(await readFile(resolve(project, 'input/decision.json'), 'utf8'));
  }
  const output = resolve(project, 'output/index.html');
  const html = await readFile(output, 'utf8');
  const slides = [...html.matchAll(/<section class="slide[^>]*>/g)];
  const foundMotions = [...html.matchAll(/data-motion="([^"]+)"/g)].map((match) => match[1]);
  const failures = [];
  const navCount = [...html.matchAll(/class="nav-dot"/g)].length;
  if (navCount !== 8) failures.push('导航数量 ' + navCount + '/8');
  const sceneClasses = ['task-core', 'compare-layout', 'compare-col', 'action-stack', 'assembly-stage', 'assembly-note', 'pipeline-grid', 'console-log', 'constellation-layout', 'constellation-stage', 'constellation-lines', 'decision-stage', 'decision-rail', 'converge-stage', 'results-halo'];
  for (const name of sceneClasses) if (!new RegExp('class="[^"\\n]*\\b' + name + '\\b').test(html)) failures.push('缺少场景结构：' + name);
  for (const id of ['previewStage', 'previewKicker', 'previewTitle', 'previewText']) if ([...html.matchAll(new RegExp('id="' + id + '"', 'g'))].length !== 1) failures.push('交互绑定缺失或重复：' + id);
  if ([...html.matchAll(/data-preview-control=/g)].length !== 2) failures.push('交互控件缺失');
  if (slides.length !== 8) failures.push(`页数 ${slides.length}/8`);
  if (new Set(foundMotions).size !== 8) failures.push(`独立动画 ${new Set(foundMotions).size}/8`);
  if (!outline.slides.every((slide) => html.includes(escapeHtml(slide.title)))) failures.push('并非所有新标题都进入 HTML');
  if (/(?:src|href)="https?:\/\//i.test(html)) failures.push('存在外部脚本、字体或样式');
  if (!html.includes('@media (prefers-reduced-motion: reduce)')) failures.push('缺少 reduced-motion 降级');
  if (decision.theme && !html.includes(`data-theme="${decision.theme}" data-focus="${decision.focus}"`)) failures.push('模板或重点未生效');
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter((match) => !match[1].includes('application/json')).map((match) => match[2]).filter((source) => source.trim());
  try { scripts.forEach((source, index) => new vm.Script(source, { filename: `inline-${index + 1}.js` })); } catch (error) { failures.push(`内联 JavaScript：${error.message}`); }
  if (failures.length) throw new Error(failures.join('；'));
  const outputStat = await stat(output);
  return { ok: true, project, output, bytes: outputStat.size, pages: slides.length, theme: decision.theme, focus: decision.focus, title: outline.deck.title, motions: foundMotions, checks: ['场景CSS结构', '8个导航', '交互控件绑定', '8页结构', '8个独立动画', '新大纲已进入HTML', '四套模板运行时', '离线单文件', 'reduced-motion', '内联脚本语法'] };
}

const args = parseArgs(process.argv.slice(2));
if (!args.workspace) throw new Error('必须提供 --workspace');
const caseRoot = resolve(args.workspace);
const result = args.command === 'render'
  ? await renderProject(caseRoot, args.project, args.theme ?? 'ocean', args.focus ?? 'result')
  : args.command === 'verify'
    ? await verifyProject(caseRoot, args.project, { theme: args.theme, focus: args.focus })
    : null;
if (!result) {
  console.log('用法：node source/generate-deck.mjs render|verify --project generated/<name> [--theme ocean] [--focus result]');
} else {
  console.log(JSON.stringify(result, null, 2));
}
