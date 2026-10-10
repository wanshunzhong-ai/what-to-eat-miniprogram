# 「今天吃什么」小程序 · 代码评审报告

> 评审范围：全部前端页面（7 个）、工具层（`utils/`）、云函数（4 个）、配置与脚本，约 9300 行。
> 评审方式：逐文件阅读 + 交叉核对 + **对关键结论做了实测/查证**。凡标注「✅ 已实测」的，都是我跑过或查过官方文档确认的，不是推断。

---

## 一、总体评价

**成熟度定位：功能闭环完整、工程意识在平均线以上的「准生产」项目。**

单机路径（推荐算法、菜品库分层、离线优先）质量相当不错，但一旦进入真实多设备、真实上游、真实异常流量，**「三防」尚未建立**：写接口鉴权、并发一致性、配置可复现。

### 做得好的（不是客套）

| 项 | 说明 |
|---|---|
| **密钥零下发** | 腾讯地图 Key、PG API Key 全在云函数环境变量，客户端拿不到 |
| **身份不信任客户端** | 用户数据一律按 `cloud.getWXContext().OPENID` 归属，前端不传 openid |
| **三级降级链路完整** | 菜品库 cloud→cache→builtin；推荐 cloud→local；外卖腾讯→OSM |
| **离线优先 + LWW** | 本地写入立即生效，云同步后台异步、失败静默；冲突按集合级时间戳 |
| **分享不依赖后端** | 菜名编码进 path，接收端免登录免云端即看（思路对，实现有 bug，见 P0-2） |
| **代码卫生** | 抽查通过：无悬空事件绑定、无 `wx:key="index"` 误用、设计 token 无死变量 |

---

## 二、必须修（P0）

### P0-1　菜品库可被任意用户整库改写 ⚠️ 最严重

**位置**：`cloudfunctions/dishes/index.js:29`、`:106-109`

```js
const ADMIN_OPENIDS = [];          // :29  白名单是空的
function canAdmin(openid) {
  if (!ADMIN_OPENIDS.length) return true;   // :107  空 = 全部放行
  return ADMIN_OPENIDS.indexOf(openid) >= 0;
}
```

**✅ 已实测确认**。任何人调用：
```js
wx.cloud.callFunction({ name:'dishes', data:{ action:'publish', list:[...] } })
```
即可**整库替换 341 道菜**；`action:'seed'` 还能重置回出厂数据。无需任何凭证，影响全体用户。

`publish` 同时**不做数据校验**（`:127` 只判 `Array.isArray && length`）；对比 `scripts/sync-dishlib.js:54-71` 有一整套字段校验，云函数侧完全没有。写入畸形数据（缺 `meal`/`category`）会让 `utils/recommender.js:199` 的 `d.meal.indexOf` 在全站抛错，推荐全线故障。

**修复**：
1. 白名单改为从环境变量读取，且**默认拒绝**（不要「留空即放行」的语义）
2. `publish` 入库前复用 `sync-dishlib.js` 的校验逻辑，另加条目数 / 字节数上限
3. 生产环境可考虑整体下线写接口，改由管理端脚本触发 `seed`

---

### P0-2　分享链接在大桌时必然失败

**位置**：`pages/result/result.js:181`、`pages/share/share.js:72`

```js
const payload = menuShare.encode(result);
if (payload && payload.length <= MAX_SHARE_PAYLOAD) {   // MAX = 700
  out.path = '/pages/share/share?m=' + encodeURIComponent(payload);
}
```

校验的是 **编码前** 长度，而真正塞进 path 的是**编码后**字符串（1 个汉字 → 9 字符，1 个 emoji → 12 字符）。

**✅ 已实测**（用真实菜名跑 `menuShare.encode`）：

| 人数 | 道数 | payload（被校验的） | 编码后 path（真实的） |
|---|---|---|---|
| 4 | 9 | 86 | 529 |
| 6 | 12 | 110 | 691 |
| 8 | 15 | 135 | 862 |
| 10 | 17 | 153 | 980 |
| 12 | 20 | 176 | 1133 |
| 15 | 23 | 202 | **1313** |

payload 永远远小于 700 → **校验形同虚设**；而真实 path 在 8 人以上就逼近/超过微信 URL 的可用长度，被截断后接收方 `decode` 失败，只看到 `pages/share/share.wxml:45` 的「这份菜单没能打开」。

**小桌能正常，所以极难被发现**——这是典型的「happy path 测试盲区」。

**修复**：校验对象改成 `encodeURIComponent(payload).length`；或压缩载荷（去 emoji、`MAX_DISHES_IN_LINK` 降到 10~12）；`pages/share/share.js:72` 的二次转发同样漏了校验，一并统一到一个工具函数。

---

### P0-3　分享页「点菜名看详情」是死交互

**位置**：`pages/share/share.wxml:20`、`:37`、`utils/menuShare.js:136`

- `:20` 条目带 `hover-class="hv-card"`（视觉上明确「可点」）
- `:37` 文案承诺「点菜名看详情即可」
- 但条目**没有任何 `bindtap`**，点下去毫无反应
- 且 `decode` 生成的 id 是 `shared_0/1/2...`，而 `pages/detail/detail.js` 走 `dishStore.getById()` 查真实 id —— **即使补上跳转也必然查不到**

**修复**：要么去掉这个承诺（纯只读清单），要么给条目加 `bindtap` 并用**菜名反查**菜品库（需给 `dishStore` 新增 `getByName`），命中才跳、否则 toast 提示。

---

### P0-4　用户数据存在静默丢失的竞态

**位置**：`cloudfunctions/recommend/userpref.js:114-122` 与 `cloudfunctions/userdata/index.js:143-145`

两条链路操作**同一张表的同一行** `eat_user_data.data`（JSONB）：

```js
// userpref.writePref —— 读整行 → 只改 pref → 整行写回
const data = (await getData(openid)) || {};
data.pref = {...}; data.prefUpdatedAt = at;
await saveData(openid, data);          // ← 整行覆盖
```

若在 recommend 的「读」与「写」之间，userdata 云函数写入/合并了收藏或历史，**recommend 的写回会用旧副本覆盖掉这些改动** —— 用户收藏被静默回滚。

触发门槛不高：用户改口味 → 触发推荐（走 recommend 写 pref）→ 同时后台同步收藏（走 userdata）。

**修复**：`userpref` 改为**键级更新**（PostgREST `PATCH` + JSONB 路径，或数据库函数原子更新 `data->'pref'`），不要整行覆盖；`userdata` 侧引入 `updated_at` 条件更新做乐观锁。

---

## 三、建议修（P1）

### P1-1　腾讯地图 Key 配了也用不上（radius 超上限）

**位置**：`cloudfunctions/nearby/index.js:274`、`config.js:32`

```js
const radius = Math.min(Math.max(Math.round(Number(e.radius) || 3000), 500), 10000);
```

**✅ 已查证官方文档**：腾讯位置服务 `boundary=nearby(lat,lng,radius)` 的 radius **取值范围仅 10~1000 米**。

而这里允许到 10000、客户端默认传 3000 → 请求必然返回参数错误（`status=300`），被 `searchTencent` 判为失败 → **每次都退回 OSM，腾讯那路形同虚设**。

**当前状态很好笑**：`nearby` 的 `Environment.Variables` 是 `null`（**至今没配 `TENCENT_LBS_KEY`**），所以这个雷还没被踩到。**一旦配了 Key，会立刻失效。**

**修复**：传给腾讯的 radius 夹到 ≤1000（`auto_extend=1` 会自动扩到 1/2/5km，正好覆盖 3km 需求）；对外展示半径与请求半径分开。

---

### P1-2　云函数超时配置没进仓库

**✅ 已实测云端配置**：`nearby Timeout=25`、`recommend Timeout=20`、`userdata Timeout=20` —— **超时是配好的**（经控制台/MCP 配置，不依赖 `config.json`）。

**但**：仓库里**没有任何 `config.json`**。这意味着重新部署、迁移环境或他人克隆项目部署时，超时会回到默认值（3s），届时：
- `nearby` 内部 OSM 超时 12s、腾讯 6s
- `pgrest` 超时 10s
全部会被平台先一步掐断，用户看到的是「网络失败」而非可读错误。

**修复**：为每个云函数补 `config.json` 固化 `{"timeout": 20}`，让配置可复现（这才是报告的真正价值，而不是「现在就会超时」）。

---

### P1-3　三份核心文件在前后端各存一份（逐字节相同）

**✅ 已比对**：

| 文件 | 行数 | 客户端 | 云函数 |
|---|---|---|---|
| `recommender.js` | 445 | `utils/` | `cloudfunctions/recommend/` |
| `cities.js` | 279 | `utils/` | `cloudfunctions/recommend/` |
| `foodData.js` | 178 | `utils/` | `cloudfunctions/recommend/` |

内容完全一致（连文件头注释都还写着 `// utils/xxx.js`）。改一处漏一处 → **云端与本地推荐结果静默分叉**，是最难排查的一类 bug。

**修复**：确立单一来源 + 同步脚本 + CI 一致性校验（`scripts/` 已有类似脚本模式可复用）。

### P1-4　两套 PG 客户端重复实现
`cloudfunctions/userdata/pgrest.js:20-59` 与 `cloudfunctions/recommend/userpref.js:24-63` 是几乎相同的 `request()`，且**超时还不一致**（10000 vs 6000）、缓存策略也不同。合并为共享模块。

### P1-5　可访问性仍有缺口
上一轮已把 `--text-light`(#B6ACA3, 2.4:1) 换成 `--ink-3`(#868E96, 4.6:1)。但 `--ink-4`(#ADB5BD, **约 2.1:1**) 仍被大量用于 20~23rpx 正文，且承载了定位精度、配送费、预算提示等**关键信息**。建议正文最低用 `--ink-3`，仅纯装饰文字留给 `--ink-4`。

### P1-6　大列表无分页/虚拟化
- `pages/city/city.js:50` 搜索**无防抖**，每敲一个字全量 `filter` + 全量 `setData`；首屏一次性渲染 **132 个**城市卡片
- `pages/mine/mine.js:94` 收藏/店铺收藏**无上限**，全量塞进 `setData`

### P1-7　`takeout.fetch` 无 `.catch`，异常会永久锁死重试
`pages/takeout/takeout.js:102` 的 `_loading` 只在成功分支复位；链路上任何意外 reject 会让 `_loading` 永远为 true，之后重试/切品类/下拉全被挡掉，页面卡死无法恢复。

### P1-8　人数不持久化（冷启动必回默认 2）
`pages/index/index.js:270` 裸改 `app.globalData.people`，而该字段**根本没在 `app.js` 的 globalData 里声明**，也不写缓存。城市有 `setCity`、偏好有 `setPref`，唯独人数不成体系。

### P1-9　`recommend` 写口味「发射后不管」
`cloudfunctions/recommend/index.js:96` 的 `writePref(...).catch()` **未 await**。云函数返回后运行时可能冻结容器，未完成的 Promise 不保证执行完 → 服务端「记住口味」时灵时不灵，**恰好废掉了这个功能的设计目的**（换手机后个性化）。

---

## 四、可选优化（P2）

- **错误信息透传内部细节**：`userdata/index.js:152` 把 `e.message`（含 `PG_HTTP_5xx: <上游文本>`）返回给客户端；`nearby` 把上游 `errors` 数组原样返回
- **`recommend` 把 openid 回传客户端**（`index.js:114`，前端无人使用）
- **客户端 `pref` 未做类型校验**：畸形 `pref.exclude`（传数字）会让 `utils/recommender.js:204` 的 `.indexOf` 抛错，整个云函数失败
- **`dishes` 读路径有写副作用**：`:54-62` 未配 `DISHLIB_FILE_ID` 时，每次冷启动都会重传 148KB 出厂数据
- **Overpass 命中后未取消其余镜像请求**（`nearby:240-259`），浪费配额；UA 未附联系方式，有被限流风险
- **缺 `onShareTimeline`**：结果页/详情页/分享页都只有 `onShareAppMessage`，朋友圈分享用不上自定义标题
- **`packOptions.ignore` 覆盖不全**：未显式排除 `cloudfunctions`、`*.genie`、`project.private.config.json`
- **开发期开关随包提交**：`project.config.json:29` `urlCheck:false`、`:44` `uploadWithSourceMap:true`，上线前应收敛
- **`base` 字段无人消费**：菜品库每条带 `base`，但引擎只按 `it[1]*people` 换算

---

## 五、修复顺序建议

```
第 1 步  P0-1  菜品库鉴权         改动最小、风险最大，先堵住
第 2 步  P0-2  分享链接长度校验   用户可感知，半天可完成
         P0-3  分享页死交互
第 3 步  P0-4  键级更新 + 乐观锁   涉及数据一致性，需配套测试
         P1-1  radius 夹到 1000
         P1-2  补 config.json
第 4 步  P1-3/4 去重（单一来源 + CI 校验）
第 5 步  P1-5 ~ P1-9 体验与健壮性
第 6 步  P2 按版本迭代逐步跟进
```

**一句话总结**：这项目「单人用没问题，一旦面对真实用户和真实流量，三道防线（鉴权 / 并发 / 配置）都还没建立」。其中 **P0-1 建议今天就修**。
