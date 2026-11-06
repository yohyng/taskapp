const productionDeployment = 'AKfycbw96279gNABhd3XrZVxzRg5jt05HpUKnbVW3h-flqdmxtSo4Hl9jS6wxkvkoZEBuvld';
export function driveRehearsalSetting(setting, manifest) {
  let url;
  try { url = new URL(setting?.url); } catch { throw new Error('新しい検証用GASの/exec URLが必要です'); }
  const match = /^\/macros\/s\/([A-Za-z0-9_-]+)\/exec$/.exec(url.pathname);
  if (url.origin !== 'https://script.google.com' || !match || match[1] === productionDeployment
    || url.search || url.hash || url.username || url.password) throw new Error('通常のGASとは別の検証用/exec URLを指定してください');
  if (manifest?.format !== 1 || manifest.kind !== 'drive-rehearsal' || manifest.synthetic !== true
    || manifest.retentionEnabled !== false || setting.folderId !== manifest.folderId || setting.rehearsalId !== manifest.rehearsalId
    || !/^[A-Za-z0-9_-]{20,80}$/.test(manifest.folderId || '') || !/^[a-f0-9]{64}$/.test(setting.token || '')) throw new Error('生成済みの検証設定とmanifestが一致しません');
  return { url: url.href, token: setting.token };
}
// 名前だけで判断しない。古いGASや通常の控え整理がある接続先へはPOSTしない。
export function checkDriveRehearsalCapability(value, manifest) {
  if (value?.ok !== true || value.backupProtocol !== 2 || value.rehearsalProtocol !== 1
    || value.folderId !== manifest.folderId || value.rehearsalId !== manifest.rehearsalId || value.retentionEnabled !== false) throw new Error('隔離した検証先と、控え整理の無効化を確認できません');
}
