// Nạp toàn bộ số liệu từ JSON. readJson(path) do môi trường cung cấp (fetch trên trình duyệt, fs trong Node).
export const DATA_FILES = {
  config: 'data/config.json',
  skills: 'data/skills.json',
  monsters: 'data/monsters.json',
  items: 'data/items.json',
  classes: 'data/classes.json',
  runes: 'data/runes.json',
  campaign: 'data/maps/campaign.json',
  mapDir: 'data/maps/',
};

const clone = (o) => JSON.parse(JSON.stringify(o));

// Dựng danh sách màn từ campaign.json: mỗi màn = màn gốc + thay đổi của chương + thay đổi riêng của màn.
// Màn thứ i (đếm từ 0): máu quái ×(1 + hpStep)^i, sát thương ×(1 + dmgStep)^i.
export function buildCampaign(campaign, templates) {
  const base = templates[campaign.base];
  const chapters = Object.fromEntries((campaign.chapters || []).map((c) => [c.id, c]));
  const maps = {};
  const order = [];
  campaign.maps.forEach((m, i) => {
    const ch = chapters[m.chapter] || {};
    const map = clone(m.template ? templates[m.template] : base);
    if (ch.obstacles) map.obstacles = { ...map.obstacles, ...clone(ch.obstacles) };
    if (ch.theme) map.theme = { ...(map.theme || {}), ...ch.theme };
    for (const [k, v] of Object.entries(m)) {
      if (k === 'obstacles') map.obstacles = { ...map.obstacles, ...clone(v) };
      else if (k !== 'template') map[k] = clone(v);
    }
    map.index = i;
    map.chapterName = ch.name || '';
    // Máu quái +hpStep, sát thương +dmgStep mỗi màn (cộng dồn). "difficulty" giữ cho hiển thị = hệ số máu.
    const hpStep = campaign.hpStep ?? campaign.difficultyStep ?? 0;
    const dmgStep = campaign.dmgStep ?? campaign.difficultyStep ?? 0;
    map.hpMult = m.hpMult ?? Math.pow(1 + hpStep, i);
    map.dmgMult = m.dmgMult ?? Math.pow(1 + dmgStep, i);
    map.difficulty = m.difficulty ?? map.hpMult;
    map.rewardMult = m.rewardMult ?? Math.pow(1 + (campaign.rewardStep ?? 0), i);
    map.itemLevelBonus = m.itemLevelBonus ?? i * (campaign.itemLevelPerMap ?? 0);
    if (campaign.randomObstacles?.enabled) map.obstacles.random = { countVariation: campaign.randomObstacles.countVariation };
    maps[map.id] = map;
    order.push(map.id);
  });
  return { maps, order };
}

export async function loadData(readJson) {
  const [config, skillsFile, monsters, items, campaign, classesFile, runesFile] = await Promise.all([
    readJson(DATA_FILES.config),
    readJson(DATA_FILES.skills),
    readJson(DATA_FILES.monsters),
    readJson(DATA_FILES.items),
    readJson(DATA_FILES.campaign),
    readJson(DATA_FILES.classes),
    readJson(DATA_FILES.runes),
  ]);
  const classes = {};
  for (const c of classesFile.classes) classes[c.id] = c;
  // Nạp các màn gốc được tham chiếu (base + "template" riêng của từng màn nếu có).
  const names = new Set([campaign.base, ...campaign.maps.map((m) => m.template).filter(Boolean)]);
  const templates = {};
  for (const n of names) templates[n] = await readJson(`${DATA_FILES.mapDir}${n}.json`);
  const { maps, order } = buildCampaign(campaign, templates);
  const skills = {};
  for (const s of skillsFile.skills) skills[s.id] = s;
  const bases = {};
  for (const b of items.bases) bases[b.id] = b;
  const uniques = {};
  for (const u of items.uniques) uniques[u.id] = u;
  return {
    config,
    monsters,
    maps,
    mapOrder: order,
    campaign,
    skills,
    skillList: skillsFile.skills,
    trees: skillsFile.trees,
    treesById: Object.fromEntries(skillsFile.trees.map((t) => [t.id, t])),
    classes,
    classList: classesFile.classes,
    tree: { className: skillsFile.className },
    items: { ...items, basesById: bases, uniquesById: uniques, setsById: Object.fromEntries((items.sets || []).map((x) => [x.id, x])) },
    runes: { ...runesFile, list: runesFile.runes, byId: Object.fromEntries(runesFile.runes.map((r) => [r.id, r])) },
    difficulties: config.difficulties,
    difficultiesById: Object.fromEntries(config.difficulties.map((d) => [d.id, d])),
  };
}
