// Nạp toàn bộ số liệu từ JSON. readJson(path) do môi trường cung cấp (fetch trên trình duyệt, fs trong Node).
export const DATA_FILES = {
  config: 'data/config.json',
  skills: 'data/skills.json',
  monsters: 'data/monsters.json',
  items: 'data/items.json',
  campaign: 'data/maps/campaign.json',
  mapDir: 'data/maps/',
};

const clone = (o) => JSON.parse(JSON.stringify(o));

// Dựng danh sách màn từ campaign.json: mỗi màn = màn gốc + thay đổi của chương + thay đổi riêng của màn.
// Độ khó màn thứ i (đếm từ 0) = (1 + difficultyStep)^i, trừ khi màn tự ghi "difficulty".
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
    map.difficulty = m.difficulty ?? Math.pow(1 + campaign.difficultyStep, i);
    map.rewardMult = m.rewardMult ?? Math.pow(1 + (campaign.rewardStep ?? 0), i);
    map.itemLevelBonus = m.itemLevelBonus ?? i * (campaign.itemLevelPerMap ?? 0);
    if (campaign.randomObstacles?.enabled) map.obstacles.random = { countVariation: campaign.randomObstacles.countVariation };
    maps[map.id] = map;
    order.push(map.id);
  });
  return { maps, order };
}

export async function loadData(readJson) {
  const [config, skillsFile, monsters, items, campaign] = await Promise.all([
    readJson(DATA_FILES.config),
    readJson(DATA_FILES.skills),
    readJson(DATA_FILES.monsters),
    readJson(DATA_FILES.items),
    readJson(DATA_FILES.campaign),
  ]);
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
    tree: { className: skillsFile.className },
    items: { ...items, basesById: bases, uniquesById: uniques },
  };
}
