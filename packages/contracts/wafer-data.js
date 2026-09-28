// PXLWAF1: sparse regions and unsigned delta-varint cell addresses. No Node dependencies.
export const MAX_WAFER_BYTES = 25 * 1024 * 1024;
export const MAX_FAILS = 5_000_000;
export const MAX_REGIONS = 1_000_000;
export const MAX_OCCUPIED_REGIONS = 100_000;
export const WAFER_HEADER_BYTES = 44;
const MAGIC = new Uint8Array([80, 88, 76, 87, 65, 70, 49, 0]);
const UINT32_MAX = 0xffffffff;
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});

export function validateWaferLayout(value) {
  if (!value || typeof value !== 'object') throw new Error('缺少产品结构');
  const layout = {};
  for (const key of ['chipCount', 'regionCount', 'rows', 'cols']) {
    const number = value[key];
    if (!Number.isSafeInteger(number) || number < 1 || number > 1_000_000) throw new Error(`${key} 必须是 1 至 1000000 的整数`);
    layout[key] = number;
  }
  if (layout.chipCount * layout.regionCount > MAX_REGIONS) throw new Error('每片 wafer 最多支持 1000000 个 region');
  if (layout.rows * layout.cols > UINT32_MAX) throw new Error('每个 region 的 row × col 不能超过 4294967295');
  return layout;
}

function checksum(bytes) {
  let crc = UINT32_MAX;
  for (let index = 0; index < bytes.length; index++) {
    if (index >= 40 && index < WAFER_HEADER_BYTES) continue;
    crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[index]) & 255];
  }
  return (crc ^ UINT32_MAX) >>> 0;
}

export function decodeWafer(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new Error('wafer 数据必须是 Uint8Array');
  if (bytes.byteLength < WAFER_HEADER_BYTES || bytes.byteLength > MAX_WAFER_BYTES) throw new Error('wafer 文件长度无效或超过 25 MiB');
  if (!MAGIC.every((value, index) => bytes[index] === value)) throw new Error('不是 PXLWAF1 格式的 wafer 文件');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flags = view.getUint32(8, true);
  if (flags > 1) throw new Error('wafer 文件包含不支持的标记');
  const layout = validateWaferLayout({ chipCount: view.getUint32(12, true), regionCount: view.getUint32(16, true), rows: view.getUint32(20, true), cols: view.getUint32(24, true) });
  const failCount = view.getUint32(28, true);
  const groupCount = view.getUint32(32, true);
  if (failCount > MAX_FAILS || groupCount > MAX_OCCUPIED_REGIONS || groupCount > layout.chipCount * layout.regionCount || groupCount > failCount) throw new Error('wafer 的 fail 或非空 region 数量超过限制');
  const payloadLength = view.getUint32(36, true);
  if (payloadLength !== bytes.length - WAFER_HEADER_BYTES) throw new Error('wafer 文件已截断或包含额外字节');
  if (checksum(bytes) !== view.getUint32(40, true)) throw new Error('wafer 文件校验失败，数据可能已损坏');
  // Each region uses two varints and each fail at least one byte; reject impossible counts before allocating.
  if (failCount + 2 * groupCount > payloadLength) throw new Error('wafer 记录数量与文件长度不符');
  let offset = WAFER_HEADER_BYTES;
  function readVarint() {
    let value = 0;
    let multiplier = 1;
    for (let index = 0; index < 5; index++) {
      if (offset >= bytes.length) throw new Error('wafer 记录已截断');
      const byte = bytes[offset++];
      const part = byte & 127;
      if (index === 4 && part > 15) throw new Error('wafer 整数超出 uint32 范围');
      value += part * multiplier;
      if (!(byte & 128)) {
        if (index > 0 && part === 0) throw new Error('wafer 整数编码不是最短形式');
        return value;
      }
      multiplier *= 128;
    }
    throw new Error('wafer 整数编码过长');
  }
  const positions = new Uint32Array(failCount);
  const groups = [];
  let consumed = 0;
  let previousRegion = 0;
  const cellCount = layout.rows * layout.cols;
  for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
    const delta = readVarint();
    if (groupIndex > 0 && delta === 0) throw new Error('wafer 存在重复 region');
    const regionIndex = previousRegion + delta;
    if (regionIndex >= layout.chipCount * layout.regionCount) throw new Error('wafer 的 chip 或 region 索引越界');
    previousRegion = regionIndex;
    const count = readVarint();
    if (!count || count > cellCount || count > failCount - consumed) throw new Error('region 的 fail 数量无效');
    let previousPosition = 0;
    for (let index = 0; index < count; index++) {
      const addressDelta = readVarint();
      if (index > 0 && addressDelta === 0) throw new Error('region 存在重复 fail 坐标');
      const position = previousPosition + addressDelta;
      if (position >= cellCount) throw new Error('region 的 fail 坐标越界');
      positions[consumed + index] = position;
      previousPosition = position;
    }
    groups.push({ regionIndex, positions: positions.subarray(consumed, consumed + count) });
    consumed += count;
  }
  if (consumed !== failCount || offset !== bytes.length) throw new Error('wafer 总数不符或包含多余记录');
  return { layout, failCount, groups, synthetic: flags === 1 };
}

export function encodeWafer(input) {
  const layout = validateWaferLayout(input.layout);
  if (!Array.isArray(input.groups) || input.groups.length > MAX_OCCUPIED_REGIONS) throw new Error('非空 region 最多支持 100000 个');
  // Grow a byte buffer rather than retaining one JS number per output byte.
  let bytes = new Uint8Array(4096);
  let offset = WAFER_HEADER_BYTES;
  function writeVarint(value) {
    do {
      if (offset >= MAX_WAFER_BYTES) throw new Error('wafer 文件超过 25 MiB');
      if (offset === bytes.length) {
        const grown = new Uint8Array(Math.min(bytes.length * 2, MAX_WAFER_BYTES));
        grown.set(bytes); bytes = grown;
      }
      const part = value % 128;
      value = Math.floor(value / 128);
      bytes[offset++] = part | (value ? 128 : 0);
    } while (value);
  }
  let failCount = 0;
  let previousRegion = 0;
  const cellCount = layout.rows * layout.cols;
  for (let index = 0; index < input.groups.length; index++) {
    const group = input.groups[index];
    if (!Number.isInteger(group.regionIndex) || group.regionIndex < 0 || group.regionIndex >= layout.chipCount * layout.regionCount || (index > 0 && group.regionIndex <= previousRegion)) throw new Error('region 必须按索引递增排列且不能重复或越界');
    if (!Array.isArray(group.positions) && !(group.positions instanceof Uint32Array)) throw new Error('fail 位置必须是数组');
    const count = group.positions.length;
    if (!count || count > cellCount || failCount + count > MAX_FAILS) throw new Error('非空 region 必须有 fail，且总 fail 数不能超过 5000000');
    writeVarint(group.regionIndex - previousRegion); writeVarint(count);
    previousRegion = group.regionIndex;
    let previousPosition = 0;
    for (let fail = 0; fail < count; fail++) {
      const position = group.positions[fail];
      if (!Number.isSafeInteger(position) || position < 0 || position >= cellCount || (fail > 0 && position <= previousPosition)) throw new Error('fail 必须按行优先地址递增排列且不能重复或越界');
      writeVarint(position - previousPosition);
      previousPosition = position;
    }
    failCount += count;
  }
  bytes = bytes.slice(0, offset);
  bytes.set(MAGIC);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, input.synthetic === true ? 1 : 0, true);
  for (const [index, key] of ['chipCount', 'regionCount', 'rows', 'cols'].entries()) view.setUint32(12 + index * 4, layout[key], true);
  view.setUint32(28, failCount, true);
  view.setUint32(32, input.groups.length, true);
  view.setUint32(36, bytes.length - WAFER_HEADER_BYTES, true);
  view.setUint32(40, checksum(bytes), true);
  return bytes;
}
