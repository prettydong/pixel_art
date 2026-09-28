# 产品与 wafer 数据（PXLWAF1）

产品固定 `chipCount=k`、`regionCount=n`、`rows`、`cols`。一个产品包含多片 wafer；每片 wafer 恰有 k 个 chip，每个 chip 恰有 n 个 region，每个 region 尺寸相同。产品结构创建后不修改，另一种结构使用新产品。产品与 wafer 属于当前用户，可在多个任务中关联同一个 wafer 文件。

一份 `.pwafer` 文件就是一片 wafer。chip、region、row、col 全部从 0 开始。fail 只记录失效单元坐标，不包含 fail 值、测试轮次或冗余资源。结构相同的文件可以导入选中的产品；文件不内嵌产品或 wafer 名称，这些保存在目录数据库及生成清单中。

## 二进制布局

无压缩包外层，无文本坐标。44 字节头部使用 little-endian uint32；后续是按 region、单元地址排序的无符号差分 varint。

| 偏移（字节） | 长度 | 内容 |
| --- | --- | --- |
| 0 | 8 | 魔数 `PXLWAF1\0`（十六进制 `50 58 4c 57 41 46 31 00`），格式版本 1 |
| 8 | 4 | flags：bit 0 为合成数据标记，其余位必须为 0 |
| 12 | 4 | chipCount |
| 16 | 4 | regionCount（每个 chip） |
| 20 | 4 | rows（每个 region） |
| 24 | 4 | cols（每个 region） |
| 28 | 4 | 全片 fail 总数 |
| 32 | 4 | 非空 region 数 |
| 36 | 4 | payload 字节长度 |
| 40 | 4 | CRC-32/ISO-HDLC：对头部字节 0..39 与 payload 连接计算，排除本字段 |
| 44 | 可变 | payload |

CRC 使用反射多项式 `0xedb88320`、初始值和最终 xor 值 `0xffffffff`。用于发现损坏，不提供真实性或来源认证。

payload 只记录有 fail 的 region，每组依次为：

1. `regionIndex` 差值：`regionIndex = chip * regionCount + region`。第一组相对于 0，后续相对于上一组。
2. 本 region 的 fail 数，必须大于 0。
3. 按升序排列的单元地址差值：`position = row * cols + col`。每组第一个地址相对于 0，之后相对于该组上一地址。

每个整数使用最短形式的 unsigned LEB128，至多 5 字节、32 位无符号范围。第一条 region/地址差值允许为 0；后续必须为正，保证严格排序且无重复。

头部显式保留完整结构，未出现的 region 有 0 个 fail。全片零 fail 时文件仅有 44 字节，所有 chip、region 仍然存在。稀疏存储无需分配 row × col 的矩阵。具体压缩程度取决于位置分布；密集失效可比位图更大，本版不自适应切换编码。

当前实现限制：每个维度 1..1000000；k × n ≤ 1000000；rows × cols ≤ 4294967295；每片 ≤ 5000000 个 fail、≤ 100000 个非空 region、≤ 25 MiB。服务器还应用实际上传限制。解码拒绝结构不符、CRC 错误、未知标记、越界、重复、非最短 varint、截断及多余字节。

## 生成测试数据

无需构建，直接使用 Node：

```bash
node scripts/generate-wafer-fails.mjs \
  --out datasets/wafer-spatial-demo \
  --chips 1000 --regions 16 --rows 32768 --cols 2048 \
  --wafers 3 --pattern mixed --mean-fails-per-region 100 \
  --strength 12 --dispersion 4 --seed 20260926
```

输出三片 wafer、生成参数与 SHA-256 清单、合成数据说明。支持随机、中心、环带、边缘环、局部边缘、局部、划痕和混合空间形态。`--mean-fails-per-region` 是每 region 的目标平均 fail 数，默认 100；内部按产品的 region 数换算为每 chip 均值，设为 0 可生成全零数据。模型及研究依据见 [WAFER_SPATIAL_MODEL.md](WAFER_SPATIAL_MODEL.md)。内容不同的已存在文件不会被覆盖。

数据页创建同样结构的产品，导入 `.pwafer` 文件即可。数据页统一采用这一格式，不提供旧 CSV 预览或格式转换入口。

## 在脚本中读取

可先用只读命令查看摘要或指定区域（最多显示 1000 个坐标，不展开全片数据）：

```bash
node scripts/read-wafer.mjs --file datasets/wafer-demo/wafer-002.pwafer
node scripts/read-wafer.mjs --file datasets/wafer-demo/wafer-002.pwafer --chip 0 --region 0 --limit 50
```

聊天任务的上下文包含已关联 wafer 的产品名、完整结构与文件 ID，以及上述工具路径。坐标明细保留在二进制文件中，由脚本按需计算。

编解码器是无 Node 专有依赖的 ES module，前端、后端和生成器共用一份实现：

```js
import { readFileSync } from 'node:fs';
import { decodeWafer } from './packages/contracts/wafer-data.js';

const wafer = decodeWafer(readFileSync('datasets/wafer-demo/wafer-002.pwafer'));
for (const group of wafer.groups) {
  const chip = Math.floor(group.regionIndex / wafer.layout.regionCount);
  const region = group.regionIndex % wafer.layout.regionCount;
  for (const position of group.positions) {
    const row = Math.floor(position / wafer.layout.cols);
    const col = position % wafer.layout.cols;
    // 使用 chip、region、row、col；空 region 由 layout 定义。
  }
}
```

通过包导入时使用 `@pixel/contracts/wafer-data`。生成端调用 `encodeWafer({ layout, groups, synthetic })`，要求 groups 和每组 positions 已严格升序且无重复。合成标记不是可信来源证明。
