export function releaseNotes(changelog, version) {
  const sections = changelog.replace(/\r\n/g, '\n').split(/^## /m);
  const section = sections.find(section => section.split('\n', 1)[0].match(/^v?(\d+(?:\.\d+)+)(?:\s|$)/)?.[1] === version);
  const notes = section?.slice(section.indexOf('\n') + 1).trim();
  if (!notes) throw new Error(`CHANGELOG.md에 ${version} 릴리스 노트가 없습니다.`);
  return { text: notes, metadata: { version: { release_notes: {
    'en-US': notes,
    ko: notes,
  } } } };
}
