// Nạp toàn bộ số liệu từ JSON. readJson(path) do môi trường cung cấp (fetch trên trình duyệt, fs trong Node).
export const DATA_FILES = {
  config: 'data/config.json',
  skills: 'data/skills.json',
  monsters: 'data/monsters.json',
  maps: { '1-1': 'data/maps/1-1.json' },
};

export async function loadData(readJson) {
  const [config, skillsFile, monsters] = await Promise.all([
    readJson(DATA_FILES.config),
    readJson(DATA_FILES.skills),
    readJson(DATA_FILES.monsters),
  ]);
  const maps = {};
  for (const [id, path] of Object.entries(DATA_FILES.maps)) maps[id] = await readJson(path);
  const skills = {};
  for (const s of skillsFile.skills) skills[s.id] = s;
  return {
    config,
    monsters,
    maps,
    skills,
    skillList: skillsFile.skills,
    tree: { className: skillsFile.className, treeName: skillsFile.treeName },
  };
}
