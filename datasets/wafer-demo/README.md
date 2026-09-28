# 合成 wafer 数据

仅用于开发和演示，不代表真实制造缺陷分布或良率。

产品结构：每片 64 个 chip，每个 chip 8 个 region，每个 region 1024 × 1024。所有索引从 0 开始。

随机种子：20260926；模式：mixed；前 1 片无 fail。每个非空 region 恰有 8 个唯一 fail；其余 region 无 fail。

在数据页新建相同结构的产品，导入 .pwafer 文件。manifest.json 保存生成参数、各片总数和 SHA-256；不要把它当 wafer 导入。

格式及读写方法见项目 WAFER_FORMAT.md。完整 chip/region 名册由头部结构定义，不能用非空记录数量代替总数。
