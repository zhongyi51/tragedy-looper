# Hydrogen、DeepSeek、Sol 与 Luna 对照（2026-11-17）

## 决策

Hydrogen low 在本次战术样本中表现良好，22/22 通过，与 Sol、DeepSeek 相同；Luna 20/22。不能据此宣称模型整体能力相同。

Hydrogen 作为备选有价值：本次冷启动战术账单低于 Sol，响应也快。但相对 DeepSeek 仍明显更贵，连续换席缓存也出现波动。本次维持生产界面原有 Sol 与官方 DeepSeek 两个选择，没有新增或替换玩家模型；Luna、Hydrogen 均为临时启用的隔离 QA 配置。

## 方法与范围

- 继续使用原有 11 个 FS/BTX/MC 战术局面，各重复 2 次；每题均由正常引擎重放合法历史，固定后续结算评分。所有四份报告的 fixture manifest hash 完全一致：`d4d3619b19962d2b43834862768f2f4f0c2e4cdfa7b0b5492821c0901fb0d6bf`。
- Sol/Luna 引用同日上一轮的原始 22 次结果，本次新调用 Hydrogen、DeepSeek。没有因答错而重抽样，也没有修改评分标准或增加模型专属提示。
- Sol/Luna：low、2,048 输出上限、显式历史缓存；Hydrogen：low、8,192 输出上限、Google Vertex global 标准路由、原样完整信息的分块消息，剥离不支持的 OpenAI 显式缓存标记。使用固定 `google/gemini-4-hydrogen`，无模型或服务商自动回退。
- DeepSeek：实际生产配置 `deepseek-flash`（官方现由 V4.1-Flash-1017 服务），复杂决策 low/8,192，简单能力非思考/1,800。四种模型不共享 tokenization，因此比较相同任务而非强制相同 token 数。
- 所有输入均包含完整玩法、局面、该席可见历史和全部合法候选。限时失败／非法输出沿用最多一次修复，费用和延迟均包括修复。
- Hydrogen high 配置仅做了传输单元测试，未付费运行；本报告不声称比较高思考档。

## 战术结果与费用

| 配置 | 剧作家 | 主人公 | 22 次决策费用 | 修复次数 | 端到端中位秒 | 最慢秒 |
|---|---:|---:|---:|---:|---:|---:|
| 官方 DeepSeek（生产配置） | 12/12 | 10/10 | $0.0611662 非高峰／$0.1223325 高峰（估算） | 1 | 11.367 | 64.001 |
| GPT-6.1 Sol low | 12/12 | 10/10 | $0.6887180（实付） | 0 | 9.177 | 13.378 |
| Gemini 4 Hydrogen low | 12/12 | 10/10 | $0.4071190（实付） | 0 | 9.357 | 10.752 |
| GPT-6 Luna low | 11/12 | 9/10 | $0.0375119（实付） | 0 | 9.838 | 16.007 |

DeepSeek 本次请求全部在 04:00–06:00 UTC 非高峰区间，按官方普通输入 $0.15、缓存输入 $0.003、输出 $0.60 / 百万 token 估算；应用仍记录两倍的高峰保守金额。它没有返回账单金额，不能将估算标为实付。官方高峰是工作日 01:00–04:00 和 06:00–10:00 UTC（中国法定节假日除外）。

相对本次 DeepSeek 非高峰估算，Sol 约 11.26 倍，Hydrogen 约 6.66 倍，Luna 约 0.61 倍；若按高峰计费，前两者倍数分别减半。

缓存条件不能忽略：Hydrogen 战术调用输入 265,082 tokens，其中 43,194 命中缓存（16.3%），输出 9,473（含推理 8,209）；Sol、Luna、DeepSeek 这一战术组缓存读取均为零。Hydrogen 实付 $0.40711905，比 Sol $0.688718 低 40.9%；按同样输出、全部输入不命中缓存估算，Hydrogen 为 $0.4686705，比 Sol 低 31.9%。这个无缓存值是费率计算，不是第二组实际账单。

Hydrogen 与 Sol 均无非法输出、截断或修复。DeepSeek 的 `fs-mastermind-resilient-three-cards@1` 截断一次，经既有完整三牌方案修复成功，费用及 64.001 秒端到端时间已包含修复。Luna 的既有两次失误仍是误读获胜技能、误读 EX 轮回末败北条件；没有因本次比较而删除失败样本。

## 连续换席：不能只看冷启动成本

使用相同原版《长夜未熄的灯》开局，实际推进 M→A→B→C。双方根据自身选择形成后续局面，因此这是运行集成样本，不是逐 token 完全相同的受控成本对照，也不能推算整局均价。

| 模型 | 返回完整结果的决策 | 后续 A/B/C 首请求缓存 tokens | 费用 |
|---|---:|---|---:|
| Sol | 4/4 | [7947, 7947, 7947] | $0.0483056 实付 |
| Hydrogen | 4/4 | [7199, 0, 0] | $0.0695669 实付 |
| DeepSeek | 3/4 | [7040, 7040]，C 无回执 | 已确认部分 $0.0137065 非高峰估算，另有未结算预留 |

此样本中 Hydrogen 的四步实际费用比 Sol 高约 44%，它的三次后续请求仅一次命中，不能稳定保持此前冷启动价格优势。这个结果不代表 Hydrogen 所有路由都没有缓存：确实观察到了缓存读取；OpenRouter 当前端点目录里的缓存能力标志也不足以代替真实测量。

DeepSeek A 席耗尽 8,192 输出额度、尚无最终 JSON，按既有非思考修复路径恢复；C 席请求收到站点层 HTTP 503 非 JSON，已停止且没有重发。后续只读对账发现局面仍在 revision 5 / C 席，4 条调用完成、1 条只留预留记录；没有供应商响应，所以不能判断该请求是否已计费，更不能记作模型战术答错。预留 $0.0217716 仍被保守保留，未擅自退款或当成实际费用；它不计入上面的完整 22 题战术得分。

## 实现、收尾与限制

- 新增 Hydrogen 的固定模型/标准 Google 路由仅限隔离 QA 白名单，保留同一 OpenRouter 密钥边界，无新密钥、任意 URL 或第三方凭据传输。普通玩家模型列表继续只有 DeepSeek 与 Sol。
- 为核对 503 的不确定请求，允许“已启用的独立 QA 服务命名空间”只读本方未终局账本。普通玩家仍须终局才能查看用量，不能访问别人的 QA 对局；新增权限测试。
- 596/596 自动化测试通过；测试后关闭 QA，并重新部署，核验 `401 QA_DISABLED`。生产模型、默认配置及用户存档均未更改。
- 11 个战术局面、两次重复属于小样本且重复不独立，含有限搜索/启发式参考；通过率不等于整局胜率，不证明 Hydrogen 与 Sol 整体能力相等。连续四步缓存仅为一次运行，成本和延迟不构成长周期保证。

本轮新增 OpenRouter 已确认实付 **$0.524991575**；DeepSeek 有回执部分的非高峰估算 **$0.074872740**；另有 **$0.0217716 未结算预留**。不重复计算上轮 Sol/Luna 22 题费用。

## 原始记录与复现

- `hydrogen-strategy-20261117.json` / `deepseek-strategy-20261117.json`：本轮 22 题原始请求用量、选择与引擎评分。
- `sol-cache-strategy-20261117.json` / `luna-strategy-20261117.json`：同日上一轮同题记录。
- `hydrogen-changing-cache-20261117.json` / `sol-changing-cache-20261117.json` / `deepseek-changing-cache-20261117.json`：连续换席及原样保留的 503、只读对账。
- `four-model-summary-20261117.json` / `hydrogen-deepseek-summary-20261117.json`：离线汇总。
- `scripts/live-strategy-v2-qa.py --provider openrouter --qa-profile hydrogen-low --replicates 2 --extra-inference`；DeepSeek 用 `--provider deepseek` 且不覆盖 QA 模型。
- `scripts/summarize-four-models.py`：核对相同测试 manifest、完整结果和 DeepSeek 费用时段后汇总。
- 战术与 Hydrogen/DeepSeek 换席源提交：`c3191a9c2e037c379f9b888b2bd0871e9cd8b69b`。对账及 Sol 换席源提交：`172e8aa2393055f2eebf3e234e32c6d23817f06d`（仅增加隔离账本读取权限）。

官方来源（2026-11-17 核验）：

- [Hydrogen 模型及 OpenRouter 标准价格](https://openrouter.ai/google/gemini-4-hydrogen)
- [OpenRouter 端点参数与路由标识](https://openrouter.ai/api/v1/models/google/gemini-4-hydrogen/endpoints)
- [Google Hydrogen 模型文档](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/4-hydrogen)
- [DeepSeek 官方价格](https://api-docs.deepseek.com/quick_start/pricing/)
