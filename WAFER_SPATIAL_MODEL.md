# Wafer 空间分布与热力图

## 研究支持什么

晶圆上的 fail 没有统一的“越靠边越多”规律。公开研究中存在中心、环带、边缘环、边缘局部、局部聚集、划痕和随机等形态。WM-811K 研究关注的是 die/chip 级通过与失效图案，不能直接提供 DEJOA 每个 chip 的内存 fail 单元数或生成参数。[Jeong 等，Scientific Reports，2023](https://www.nature.com/articles/s41598-023-34147-2)；[Wu 等，IEEE TSM，2015](https://ieeexplore.ieee.org/document/6932449/)。

Bae、Hwang、Kuo 的研究将 chip 的空间位置作为缺陷计数的解释变量，并比较 Poisson、负二项及零膨胀 Poisson 模型。它支持“计数建模应考虑空间位置、聚集和零缺陷 chip”的思路，不能替代具体产品的实测标定。[IIE Transactions，2007，DOI: 10.1080/07408170701275335](https://www.tandfonline.com/doi/full/10.1080/07408170701275335)。

本项目只借鉴上述形态及统计建模思路。下列数值、形态函数和组合是开发用假设，未拟合 DEJOA 实测数据，也不用于声称真实良率或推断工艺原因。

## 位置：disk-grid-v1

用户要求圆盘内铺满 chip 网格。当前 `.pwafer` 没有实测 chip 物理坐标，因此选择离中心最近的 K 个整数网格点，并按从上到下、从左到右编号。半径相同的位置按 y、x 决定先后。恰好 K 个 chip，无内部留洞；少量边缘位置可能因 K 的取值而不完全对称。布局、生成与渲染使用同一个 `createWaferMap()`。

坐标是示意网格，不表示晶圆直径、die 尺寸、划片道、notch 方位、实际 wafer sort 编号或实测位置。导入外部 `.pwafer` 时也明确标注这一限制。目前自动空间生成与圆盘预览支持最多 10000 个 chip；region 内坐标预览不依赖这个上限。

## 计数：spatial-gamma-poisson-v2

给每个 chip 一个位置得分 `s_i`。支持 random、center、donut、edge-ring、edge-local、local、scratch、mixed；局部位置与方向来自记录的随机种子。random 使用相同得分，其他模式使用径向、局部二维高斯或窄带函数，mixed 合并环带、边缘局部和划痕得分。

```text
w_i = exp(strength * s_i) / mean_j(exp(strength * s_j))
G_i ~ Gamma(shape=dispersion, scale=1/dispersion)
lambda_i = meanFails * w_i * G_i
N_i ~ Poisson(lambda_i)
```

因此 `meanFails` 是对整片 wafer 的无条件目标平均数，单次生成结果会波动。生成器不再按概率强制将整个 chip 置零；低强度位置的 Poisson 抽样仍可能自然得到零。`dispersion` 越小，chip 间随机波动越大。默认 `每 region 平均 100 fail、strength=12、dispersion=4`（DEJOA 每 chip 为 1600 fail） 只是便于观察模式的示例值。

每个 chip 的 `N_i` 分配到一段随机起始的 region 序列，再在 region 内不放回采样唯一行优先地址；这是示意的 region 分配，未建立真实 bank、bitline、wordline 失效机制。仍保留所有零 fail chip 和 region。总 fail、坐标容量、非空 region 数或文件大小超过格式限制时明确报错，不悄悄裁减。

## 热力图的含义

- 每格一个 chip，数值严格等于解码后该 chip 所有 region 的 `positions.length` 之和。
- 灰色表示零 fail，圆盘外空白表示没有 chip；这两个状态分开。
- 正数使用五档离散顺序色，不做颜色平滑或空间插值。图例明确显示各档整数范围。
- 可选线性与 `log1p` 对数尺度。对数尺度让小值和聚集同时可见，数值仍显示原始 fail 数。
- 色阶按当前 wafer 最大值计算；跨 wafer 比较应参考图例与精确值，不能仅比较颜色。
- 点击或键盘选择 chip 联动 region 预览。0-based 的 chip/region/row/col 在全部视图中一致。
- 含 fail chip 的比例不叫作“良率”，因为没有执行冗余修补或产品合格判定。

## 生成、保存与复现

网页“生成 Wafer”在 Web Worker 中计算，完成后通过同一导入链路保存 `.pwafer` 并关联当前任务，自动显示整片热图。生成时的模式、种子和参数保存到 wafer 目录记录，并进入聊天任务上下文。二进制本身只保存合成标记和 fail 数据；单独下载再导入二进制不会恢复生成参数。

CLI 同时输出每片参数、SHA-256 与统计摘要的 manifest，可直接复现：

```bash
node scripts/generate-wafer-fails.mjs \
  --out datasets/dejoa-spatial-demo/edge-ring \
  --prefix DEJOA-edge-ring \
  --chips 1000 --regions 16 --rows 32768 --cols 2048 \
  --wafers 1 --pattern edge-ring --mean-fails-per-region 100 \
  --strength 12 --dispersion 4 --seed 20260926
```

同参数、种子和模型版本产生相同二进制。导入文件只根据实际坐标计算颜色，不根据文件名或模式标签伪造热图。浏览器与 Node 使用同一生成模块；不同 JavaScript 引擎的浮点数学细节可能影响临界随机采样，严谨归档以二进制 SHA-256 为准。
