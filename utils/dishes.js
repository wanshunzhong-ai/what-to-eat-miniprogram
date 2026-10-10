// utils/dishes.js
// 菜品库的「精简内置兜底」。
//
// 完整菜品库（341 道）已迁到 data/dishlib.json，由云函数 dishes 在运行时下发，
// 小程序端不再内嵌完整库 —— 加菜 / 改菜不用改代码、不用发版。
//
// 这里只保留一份覆盖全部分类的小数据集，用于兜底：
//   1) 首次打开且无网络时，仍能配出一桌合理的菜；
//   2) 云函数与本地缓存都不可用时的最后一道防线。
//
// 运行时请优先使用 utils/dishStore.js（云端 → 本地缓存 → 本文件兜底）。

const FALLBACK_DISHES = [
  { id: 'jcj02', name: '青椒肉丝', emoji: '🫑', cuisine: '家常菜', category: '荤', spicy: 1, meal: ["lunch","dinner"], time: 15, difficulty: 1, base: 2, desc: '家常快手，肉嫩椒香', ing: [["青椒",100,"g"],["猪瘦肉",90,"g"],["蒜",6,"g"]], sea: ["生抽","淀粉","料酒"], steps: ["肉丝上浆腌 10 分钟","滑炒肉丝盛出","炒青椒后回锅调味"], tip: '肉丝上浆后炒出来更嫩' },
  { id: 'cd01', name: '麻婆豆腐', emoji: '🌶️', cuisine: '川菜', category: '荤', spicy: 2, meal: ["lunch","dinner"], time: 20, difficulty: 1, base: 2, desc: '麻辣鲜香，豆腐嫩滑，最下饭的川味经典', ing: [["嫩豆腐",150,"g"],["牛肉末",40,"g"],["小葱",5,"g"]], sea: ["郫县豆瓣酱","花椒粉","蒜末"], steps: ["豆腐切块，加淡盐水焯 1 分钟捞出","热油炒香豆瓣酱与牛肉末，加水煮开","下豆腐小火烧 5 分钟，勾芡后撒花椒粉和葱花"], tip: '勾芡分两次，汤汁更挂味' },
  { id: 'yy01', name: '白切鸡', emoji: '🍗', cuisine: '粤菜', category: '荤', spicy: 0, meal: ["lunch","dinner"], time: 40, difficulty: 2, base: 2, desc: '皮爽肉滑，原汁原味，考验火候', ing: [["三黄鸡",250,"g"],["姜",15,"g"],["葱",15,"g"]], sea: ["姜蓉","盐","花生油"], steps: ["整鸡下沸水，提放三次后浸煮 18 分钟","捞出立即过冰水，皮更爽脆","斩件装盘，配姜蓉蘸料"], tip: '过冰水是"皮爽"的关键' },
  { id: 'xc01', name: '剁椒鱼头', emoji: '🐟', cuisine: '湘菜', category: '荤', spicy: 3, meal: ["lunch","dinner"], time: 35, difficulty: 2, base: 3, desc: '红艳鲜辣，鱼肉嫩滑，湘菜代表作', ing: [["胖头鱼头",200,"g"],["剁椒",60,"g"],["姜蒜",15,"g"]], sea: ["蒸鱼豉油","料酒","豆豉"], steps: ["鱼头对半剖开，抹料酒盐腌 15 分钟","铺满剁椒和姜蒜豆豉","大火蒸 12 分钟，淋豉油浇热油，撒葱花"], tip: '蒸的时间按鱼头大小调整，宁短勿长' },
  { id: 'lc01', name: '糖醋鲤鱼', emoji: '🐟', cuisine: '鲁菜', category: '荤', spicy: 0, meal: ["lunch","dinner"], time: 40, difficulty: 3, base: 3, desc: '外酥里嫩，酸甜适口，鲁菜名菜', ing: [["鲤鱼",250,"g"],["面粉",40,"g"],["番茄酱",30,"g"]], sea: ["白醋","白糖","淀粉"], steps: ["鱼改花刀，裹粉糊炸至定型金黄","复炸一次更酥脆","熬糖醋汁浇在鱼身上"], tip: '糖醋汁要熬到冒泡拉丝' },
  { id: 'sc01', name: '松鼠鳜鱼', emoji: '🐟', cuisine: '苏菜', category: '荤', spicy: 0, meal: ["lunch","dinner"], time: 45, difficulty: 3, base: 3, desc: '形似松鼠，酸甜酥脆，苏帮头牌', ing: [["鳜鱼",250,"g"],["淀粉",50,"g"],["松子",10,"g"]], sea: ["番茄酱","白糖","白醋"], steps: ["鱼去骨改麦穗花刀，拍粉","炸至金黄卷曲成松鼠状","浇酸甜汁撒松子"], tip: '花刀要切到皮不破，炸后才开花' },
  { id: 'zc01', name: '西湖醋鱼', emoji: '🐟', cuisine: '浙菜', category: '荤', spicy: 0, meal: ["lunch","dinner"], time: 30, difficulty: 3, base: 2, desc: '酸甜清香，杭帮名菜', ing: [["草鱼",250,"g"],["姜末",10,"g"],["葱",10,"g"]], sea: ["米醋","白糖","酱油"], steps: ["草鱼从背部剖开，汆水断生","捞出摆盘","熬糖醋芡汁浇上，撒姜末"], tip: '汆鱼时水不能大滚，肉才嫩' },
  { id: 'xb03', name: '新疆大盘鸡', emoji: '🍗', cuisine: '西北菜', category: '荤', spicy: 2, meal: ["lunch","dinner"], time: 50, difficulty: 2, base: 4, desc: '鸡块土豆配皮带面，一锅两吃', ing: [["鸡腿肉",150,"g"],["土豆",100,"g"],["皮带面",80,"g"]], sea: ["干辣椒","豆瓣酱","啤酒"], steps: ["鸡块煸炒上色，加豆瓣酱干辣椒","倒啤酒加土豆炖 25 分钟","铺上煮好的皮带面"], tip: '汤汁留多一点拌面才香' },
  { id: 'db01', name: '锅包肉', emoji: '🍖', cuisine: '东北菜', category: '荤', spicy: 0, meal: ["lunch","dinner"], time: 35, difficulty: 2, base: 2, desc: '外酥里嫩，酸甜可口', ing: [["猪里脊",130,"g"],["土豆淀粉",50,"g"],["胡萝卜丝",20,"g"]], sea: ["白糖","白醋","番茄酱"], steps: ["里脊切片挂浓稠淀粉糊","炸至定型，复炸至酥脆","倒入酸甜汁快速翻匀"], tip: '汁要熬浓再下肉，才能裹住' },
  { id: 'mc01', name: '荔枝肉', emoji: '🍖', cuisine: '闽菜', category: '荤', spicy: 1, meal: ["lunch","dinner"], time: 30, difficulty: 2, base: 2, desc: '形似荔枝，酸甜酥香', ing: [["猪里脊",130,"g"],["马蹄",40,"g"],["番茄酱",20,"g"]], sea: ["白糖","白醋","蒜末"], steps: ["里脊改十字花刀切块，裹粉炸开花","马蹄焯熟","调酸甜汁翻炒均匀"], tip: '花刀切至三分之二深，炸后才卷曲' },
  { id: 'jcj13', name: '蒸水蛋', emoji: '🥚', cuisine: '家常菜', category: '素', spicy: 0, meal: ["breakfast","lunch","dinner"], time: 15, difficulty: 1, base: 2, desc: '嫩如布丁，老少皆宜', ing: [["鸡蛋",1.5,"个"],["温水",200,"ml"],["小葱",5,"g"]], sea: ["盐","生抽","香油"], steps: ["蛋液加温水打匀过筛","盖保鲜膜扎孔","中火蒸 10 分钟，淋生抽香油"], tip: '蛋水比例 1:1.5，过筛去泡才光滑' },
  { id: 'cd07', name: '酸辣土豆丝', emoji: '🥔', cuisine: '川菜', category: '素', spicy: 1, meal: ["lunch","dinner"], time: 15, difficulty: 1, base: 2, desc: '爽脆开胃，三分钟搞定的快手菜', ing: [["土豆",150,"g"],["青椒",30,"g"],["干辣椒",3,"g"]], sea: ["白醋","盐","花椒"], steps: ["土豆切细丝，清水冲洗去淀粉后沥干","热油爆香干辣椒花椒","下土豆丝大火快炒，沿锅边淋醋，加盐和青椒丝炒匀"], tip: '冲去淀粉才爽脆，醋要沿锅边淋' },
  { id: 'yy05', name: '蒜蓉炒时蔬', emoji: '🥬', cuisine: '粤菜', category: '素', spicy: 0, meal: ["lunch","dinner"], time: 10, difficulty: 1, base: 2, desc: '清甜爽口，餐桌上的一抹绿', ing: [["菜心",150,"g"],["蒜",8,"g"],["枸杞",5,"g"]], sea: ["盐","蚝油","花生油"], steps: ["菜心洗净，水中加少许油盐焯 1 分钟","爆香蒜末","下菜心大火翻炒，加盐和蚝油调味"], tip: '焯水时加油，菜色更翠绿' },
  { id: 'xc06', name: '手撕包菜', emoji: '🥬', cuisine: '湘菜', category: '素', spicy: 1, meal: ["lunch","dinner"], time: 15, difficulty: 1, base: 2, desc: '脆爽微辣，成本极低的宝藏菜', ing: [["包菜",180,"g"],["五花肉",30,"g"],["干辣椒",4,"g"]], sea: ["陈醋","生抽","蒜"], steps: ["包菜手撕成片，洗净沥干","煸香五花肉和干辣椒蒜","下包菜大火快炒，沿锅边淋醋调味"], tip: '手撕比刀切更入味' },
  { id: 'lc05', name: '醋溜白菜', emoji: '🥬', cuisine: '鲁菜', category: '素', spicy: 1, meal: ["lunch","dinner"], time: 15, difficulty: 1, base: 2, desc: '酸香脆爽，解腻神器', ing: [["白菜帮",180,"g"],["干辣椒",4,"g"],["蒜",8,"g"]], sea: ["陈醋","生抽","白糖"], steps: ["白菜帮斜刀切片","爆香干辣椒蒜末","下白菜大火快炒，淋醋调味"], tip: '只用白菜帮，口感更脆' },
  { id: 'v16', name: '素炒芦蒿', emoji: '🌿', cuisine: '苏菜', category: '素', spicy: 0, meal: ["lunch","dinner"], time: 12, difficulty: 1, base: 2, desc: '清香脆嫩，南京人的心头好', ing: [["芦蒿",160,"g"],["香干",50,"g"]], sea: ["盐","糖","香油"], steps: ["芦蒿掐去老根只留嫩茎","香干切丝","大火快炒，调味淋香油"], tip: '芦蒿只取嫩茎，老的纤维嚼不动' },
  { id: 'zc06', name: '油焖春笋', emoji: '🎋', cuisine: '浙菜', category: '素', spicy: 0, meal: ["lunch","dinner"], time: 20, difficulty: 1, base: 2, desc: '咸甜脆嫩，春日限定', ing: [["春笋",180,"g"],["小葱",10,"g"],["姜",5,"g"]], sea: ["生抽","白糖","香油"], steps: ["春笋切滚刀块焯水","油锅煸炒至微黄","加生抽糖焖 5 分钟收汁"], tip: '春笋先焯水去涩' },
  { id: 'v19', name: '孜然土豆', emoji: '🥔', cuisine: '西北菜', category: '素', spicy: 1, meal: ["lunch","dinner"], time: 20, difficulty: 1, base: 2, desc: '街边烧烤味，在家也能做', ing: [["土豆",200,"g"],["孜然",5,"g"]], sea: ["辣椒粉","盐","白芝麻"], steps: ["土豆切条煮至半熟","炸或煎至金黄","撒孜然辣椒盐翻匀"], tip: '先煮后炸，外脆里糯' },
  { id: 'jcj07', name: '紫菜蛋花汤', emoji: '🍲', cuisine: '家常菜', category: '汤', spicy: 0, meal: ["lunch","dinner"], time: 10, difficulty: 1, base: 2, desc: '几分钟搞定，鲜香清淡', ing: [["紫菜",8,"g"],["鸡蛋",0.5,"个"],["虾皮",5,"g"]], sea: ["盐","香油","葱花"], steps: ["水开下紫菜虾皮","淋入蛋液成蛋花","调味点香油"], tip: '蛋液要慢慢淋，蛋花才漂亮' },
  { id: 'cd16', name: '番茄圆子汤', emoji: '🍲', cuisine: '川菜', category: '汤', spicy: 0, meal: ["lunch","dinner"], time: 20, difficulty: 1, base: 2, desc: '酸甜开胃，肉圆嫩滑的川式家常汤', ing: [["番茄",120,"g"],["猪肉末",60,"g"],["小葱",5,"g"]], sea: ["盐","白胡椒粉","淀粉"], steps: ["肉末加淀粉、盐、少许水，顺一个方向搅上劲","番茄切块炒出汁，加水煮开","挤入肉圆煮熟，调味撒葱花"], tip: '肉末分次打水搅上劲，圆子才嫩' },
  { id: 'yy09', name: '冬瓜薏米排骨汤', emoji: '🍲', cuisine: '粤菜', category: '汤', spicy: 0, meal: ["lunch","dinner"], time: 60, difficulty: 1, base: 3, desc: '清润祛湿，一锅老火靓汤', ing: [["排骨",100,"g"],["冬瓜",120,"g"],["薏米",20,"g"]], sea: ["姜片","盐","蜜枣"], steps: ["排骨焯水去浮沫","所有材料入锅加水，大火煮开转小火煲 45 分钟","出锅前加盐调味"], tip: '冬瓜后放半小时，口感更好' },
  { id: 'v149', name: '奶汤蒲菜', emoji: '🍲', cuisine: '鲁菜', category: '汤', spicy: 0, meal: ["lunch","dinner"], time: 30, difficulty: 2, base: 3, desc: '汤白如奶，蒲菜脆嫩', ing: [["蒲菜",150,"g"],["高汤",300,"ml"]], sea: ["盐","牛奶","葱姜"], steps: ["蒲菜切段焯水","高汤煮开","下蒲菜加牛奶调味"], tip: '加少许牛奶，汤色更白' },
  { id: 'zc05', name: '宋嫂鱼羹', emoji: '🍲', cuisine: '浙菜', category: '汤', spicy: 0, meal: ["lunch","dinner"], time: 35, difficulty: 3, base: 2, desc: '鲜滑酸香，杭帮老味道', ing: [["鳜鱼肉",100,"g"],["香菇",30,"g"],["鸡蛋",0.5,"个"]], sea: ["香醋","高汤","淀粉"], steps: ["鱼肉蒸熟拆散","香菇火腿切丝与高汤同煮","下鱼肉勾芡，淋蛋液点醋"], tip: '起锅前点香醋提味' },
  { id: 'v46', name: '酸菜粉丝汤', emoji: '🍲', cuisine: '东北菜', category: '汤', spicy: 0, meal: ["lunch","dinner"], time: 25, difficulty: 1, base: 3, desc: '酸爽暖身，配白肉最搭', ing: [["酸菜",100,"g"],["粉丝",40,"g"],["五花肉",60,"g"]], sea: ["盐","姜","白胡椒粉"], steps: ["五花肉切片煸出油","下酸菜炒香，加水煮开","下粉丝煮软调味"], tip: '酸菜先炒一下，酸香更浓' },
  { id: 'jcj10', name: '蛋炒饭', emoji: '🍚', cuisine: '家常菜', category: '主食', spicy: 0, meal: ["breakfast","lunch","dinner"], time: 15, difficulty: 1, base: 1, desc: '粒粒分明，剩饭的最佳归宿', ing: [["米饭",150,"g"],["鸡蛋",1,"个"],["火腿丁",30,"g"]], sea: ["盐","生抽","葱花"], steps: ["鸡蛋炒散盛出","下米饭炒散","加蛋和火腿炒匀调味"], tip: '用隔夜饭，水分少才粒粒分明' },
  { id: 'cd14', name: '担担面', emoji: '🍜', cuisine: '川菜', category: '主食', spicy: 2, meal: ["lunch","dinner"], time: 20, difficulty: 1, base: 1, desc: '麻辣鲜香，一口入魂的川味面食', ing: [["细面条",100,"g"],["猪肉末",40,"g"],["芽菜",15,"g"]], sea: ["红油","花椒粉","生抽","香醋","芝麻酱"], steps: ["炒香肉末与芽菜，做成臊子","碗底调好红油、生抽、香醋、芝麻酱","面条煮熟捞入碗中，浇臊子撒葱花"], tip: '碗底料先调好，面下锅拌开就吃，最香' },
  { id: 'yy07', name: '干炒牛河', emoji: '🍜', cuisine: '粤菜', category: '主食', spicy: 0, meal: ["lunch","dinner"], time: 20, difficulty: 2, base: 2, desc: '镬气十足，河粉爽滑不碎', ing: [["河粉",150,"g"],["牛肉",80,"g"],["银芽",50,"g"]], sea: ["老抽","生抽","蚝油"], steps: ["牛肉切片腌 15 分钟，河粉常温回软","牛肉滑炒至变色盛出","下河粉大火快炒，加酱汁与牛肉银芽炒匀"], tip: '河粉别提前掰散，热锅快炒最香' },
  { id: 'lc06', name: '鲅鱼饺子', emoji: '🥟', cuisine: '鲁菜', category: '主食', spicy: 0, meal: ["lunch","dinner"], time: 60, difficulty: 3, base: 3, desc: '胶东特色，鲜掉眉毛', ing: [["鲅鱼肉",130,"g"],["猪肉末",40,"g"],["韭菜",40,"g"]], sea: ["花椒水","姜末","香油"], steps: ["鲅鱼去刺取肉，加花椒水搅打上劲","拌入肉末韭菜调成馅","包好下锅煮至浮起"], tip: '花椒水要少量多次打入才嫩' },
  { id: 'sc06', name: '阳春面', emoji: '🍜', cuisine: '苏菜', category: '主食', spicy: 0, meal: ["breakfast","lunch"], time: 15, difficulty: 1, base: 1, desc: '一碗清汤面，简单却讲究', ing: [["细面",100,"g"],["小葱",10,"g"],["猪油",8,"g"]], sea: ["生抽","盐","高汤"], steps: ["碗中放猪油、生抽、葱花冲入热高汤","面条煮至断生","捞入碗中即可"], tip: '猪油和葱花是灵魂' },
  { id: 'zc07', name: '片儿川', emoji: '🍜', cuisine: '浙菜', category: '主食', spicy: 0, meal: ["breakfast","lunch"], time: 20, difficulty: 1, base: 1, desc: '雪菜笋片肉丝面，杭州人的早晨', ing: [["面条",100,"g"],["雪菜",40,"g"],["笋片",40,"g"]], sea: ["生抽","猪油","高汤"], steps: ["雪菜肉丝笋片炒香","加高汤煮开","下面条煮熟连汤装碗"], tip: '雪菜先炒过更香' },
  { id: 'xb01', name: '兰州牛肉面', emoji: '🍜', cuisine: '西北菜', category: '主食', spicy: 1, meal: ["breakfast","lunch"], time: 30, difficulty: 2, base: 1, desc: '一清二白三红四绿，汤清面劲', ing: [["拉面",120,"g"],["牛肉",60,"g"],["白萝卜",40,"g"]], sea: ["牛骨汤","辣椒油","香菜蒜苗"], steps: ["牛骨汤加萝卜煮出味","面条下锅煮熟","浇汤码牛肉，加辣油香菜"], tip: '汤要清，辣油要香' },
  { id: 'xs11', name: '韭菜猪肉水饺', emoji: '🥟', cuisine: '小吃', category: '主食', spicy: 0, meal: ["lunch","dinner"], time: 50, difficulty: 2, base: 3, desc: '皮薄馅大，家的味道', ing: [["饺子皮",60,"g"],["猪肉末",90,"g"],["韭菜",60,"g"]], sea: ["生抽","香油","姜末"], steps: ["猪肉末加调料搅上劲，拌入韭菜","包成饺子","沸水下锅煮至浮起"], tip: '点两次凉水，饺子皮更筋道' },
  { id: 'jcj09', name: '凉拌黄瓜', emoji: '🥒', cuisine: '家常菜', category: '凉菜', spicy: 1, meal: ["lunch","dinner"], time: 10, difficulty: 1, base: 2, desc: '清脆爽口，解腻必备', ing: [["黄瓜",150,"g"],["蒜",10,"g"],["小米辣",5,"g"]], sea: ["生抽","香醋","香油"], steps: ["黄瓜拍裂切段","加蒜末小米辣","淋调料拌匀腌 5 分钟"], tip: '拍裂比切片更入味' },
  { id: 'cd09', name: '蒜泥白肉', emoji: '🥩', cuisine: '川菜', category: '凉菜', spicy: 2, meal: ["lunch","dinner"], time: 30, difficulty: 2, base: 2, desc: '肥瘦相间，蒜香浓郁，夏天最爱', ing: [["二刀肉",120,"g"],["黄瓜",60,"g"],["蒜",15,"g"]], sea: ["红油","生抽","白糖"], steps: ["猪肉冷水下锅加姜葱煮 25 分钟，关火焖 10 分钟","肉晾凉切薄片，黄瓜切片垫底","蒜泥加红油生抽糖调汁，淋在肉片上"], tip: '肉要晾凉再切，才干爽成形' },
  { id: 'yy11', name: '卤水拼盘', emoji: '🍖', cuisine: '粤菜', category: '凉菜', spicy: 0, meal: ["lunch","dinner"], time: 60, difficulty: 2, base: 3, desc: '卤香入味，拼上几样就是一碟好冷盘', ing: [["卤鹅掌",80,"g"],["卤豆腐",80,"g"],["卤鸡蛋",1,"个"]], sea: ["卤水","蒜蓉醋"], steps: ["卤水烧开下食材，小火卤 40 分钟","关火浸泡放凉更入味","切件拼盘，配蒜蓉醋蘸食"], tip: '卤好别急着捞，浸泡过夜更香' },
  { id: 'v40', name: '麻辣鸭脖', emoji: '🌶️', cuisine: '湘菜', category: '凉菜', spicy: 2, meal: ["lunch","dinner"], time: 50, difficulty: 2, base: 2, desc: '麻辣鲜香，啃得停不下来', ing: [["鸭脖",200,"g"]], sea: ["卤料","花椒","干辣椒"], steps: ["鸭脖焯水去腥","加卤料小火卤 40 分钟","关火浸泡晾凉"], tip: '卤好放冰箱泡一夜最入味' },
  { id: 'sc08', name: '南京盐水鸭', emoji: '🦆', cuisine: '苏菜', category: '凉菜', spicy: 0, meal: ["lunch","dinner"], time: 70, difficulty: 2, base: 3, desc: '皮白肉嫩，咸香回甘，金陵第一味', ing: [["鸭腿",200,"g"],["姜",15,"g"],["葱",15,"g"]], sea: ["花椒盐","料酒","八角"], steps: ["鸭腿用花椒盐腌 4 小时以上","冷水下锅加姜葱八角，小火煮 30 分钟","关火浸 20 分钟后捞出放凉斩件"], tip: '腌够时间，再"煮后浸泡"才够嫩' },
  { id: 'yy10', name: '广式虾饺', emoji: '🥟', cuisine: '粤菜', category: '小吃', spicy: 0, meal: ["breakfast","lunch"], time: 45, difficulty: 3, base: 2, desc: '晶莹剔透，一口一个鲜虾', ing: [["虾仁",100,"g"],["澄面",60,"g"],["肥膘肉",15,"g"]], sea: ["盐","糖","白胡椒粉"], steps: ["澄面用沸水烫熟揉成团，醒 15 分钟","虾仁剁碎调味拌成馅","擀皮包馅捏褶，大火蒸 6 分钟"], tip: '烫面要用滚水，皮才透明' },
  { id: 'v53', name: '臭豆腐', emoji: '🍢', cuisine: '小吃', category: '小吃', spicy: 1, meal: ["lunch","dinner"], time: 20, difficulty: 1, base: 2, desc: '闻着臭吃着香，夜市顶流', ing: [["臭豆腐",150,"g"]], sea: ["辣椒酱","蒜末","香菜"], steps: ["臭豆腐沥干","中油温炸至鼓胀金黄","戳洞淋上蒜蓉辣椒汁"], tip: '炸到外皮鼓起才够酥' },
  { id: 'v135', name: '芋泥', emoji: '🍠', cuisine: '闽菜', category: '小吃', spicy: 0, meal: ["lunch","dinner"], time: 40, difficulty: 2, base: 2, desc: '细腻绵密，甜而不腻', ing: [["槟榔芋",200,"g"],["猪油",20,"g"]], sea: ["白糖","熟芝麻"], steps: ["芋头蒸熟压成泥","加猪油白糖炒匀","撒芝麻装盘"], tip: '炒到能挂勺，口感最绵' },
  { id: 'v167', name: '炸灌肠', emoji: '🍢', cuisine: '京菜', category: '小吃', spicy: 0, meal: ["lunch","dinner"], time: 25, difficulty: 2, base: 2, desc: '外酥里嫩，蘸蒜汁最地道', ing: [["灌肠",150,"g"]], sea: ["蒜汁","盐","油"], steps: ["灌肠切滚刀薄片","中油温炸至微鼓","蘸蒜汁食用"], tip: '切得一边厚一边薄，炸出来才酥脆' },
  { id: 'v140', name: '面窝', emoji: '🍩', cuisine: '鄂菜', category: '小吃', spicy: 0, meal: ["breakfast"], time: 30, difficulty: 2, base: 2, desc: '武汉过早标配，中间薄四周厚', ing: [["大米",80,"g"],["黄豆",20,"g"]], sea: ["盐","葱花","姜末"], steps: ["米豆泡软磨浆调味","舀入面窝勺","中油温炸至金黄"], tip: '中间挖孔，炸得更透更酥' },
  { id: 'xw03', name: '凯撒沙拉', emoji: '🥗', cuisine: '西餐', category: '轻食', spicy: 0, meal: ["lunch","dinner"], time: 15, difficulty: 1, base: 1, desc: '清爽解腻，低负担', ing: [["罗马生菜",100,"g"],["鸡胸肉",60,"g"],["面包丁",20,"g"]], sea: ["凯撒汁","帕玛森芝士","黑胡椒"], steps: ["生菜撕块，鸡胸煎熟切条","拌入凯撒汁","撒面包丁和芝士"], tip: '生菜冰水泡一下更脆' },
  { id: 'qs01', name: '鸡胸肉蔬菜沙拉', emoji: '🥗', cuisine: '轻食', category: '轻食', spicy: 0, meal: ["lunch","dinner"], time: 15, difficulty: 1, base: 1, desc: '低脂高蛋白，减脂友好', ing: [["鸡胸肉",100,"g"],["混合生菜",100,"g"],["圣女果",50,"g"]], sea: ["油醋汁","黑胡椒","盐"], steps: ["鸡胸腌后煎熟切片","蔬菜洗净沥干","淋油醋汁拌匀"], tip: '鸡胸煎前拍松更嫩' },
  { id: 'qs03', name: '藜麦鸡胸碗', emoji: '🥣', cuisine: '轻食', category: '轻食', spicy: 0, meal: ["lunch","dinner"], time: 20, difficulty: 1, base: 1, desc: '营养均衡，饱腹感强', ing: [["藜麦",60,"g"],["鸡胸肉",80,"g"],["西兰花",60,"g"]], sea: ["油醋汁","黑胡椒","海盐"], steps: ["藜麦煮熟","鸡胸煎熟切块，蔬菜焯熟","组合淋汁"], tip: '藜麦煮前冲洗去涩' },
  { id: 'qs04', name: '全麦金枪鱼三明治', emoji: '🥪', cuisine: '轻食', category: '轻食', spicy: 0, meal: ["breakfast","lunch"], time: 10, difficulty: 1, base: 1, desc: '快手轻食，通勤早餐首选', ing: [["全麦面包",2,"片"],["金枪鱼罐头",60,"g"],["生菜",30,"g"]], sea: ["沙拉酱","黑胡椒","柠檬汁"], steps: ["金枪鱼加沙拉酱拌匀","面包夹生菜和金枪鱼","对切即可"], tip: '金枪鱼沥干水分再用' },
  { id: 'v117', name: '麻辣香锅', emoji: '🍲', cuisine: '川菜', category: '火锅', spicy: 2, meal: ["lunch","dinner"], time: 30, difficulty: 2, base: 3, desc: '一锅乱炖，麻辣过瘾', ing: [["五花肉",80,"g"],["藕片",60,"g"],["土豆片",60,"g"],["花菜",60,"g"]], sea: ["麻辣香锅料","干辣椒","花椒"], steps: ["难熟的食材先焯水","炒香底料","下所有食材大火翻炒入味"], tip: '食材分批处理，口感才不糊' }

];

const CATEGORY_ORDER = ['荤', '素', '汤', '主食', '凉菜', '轻食', '小吃', '火锅'];

function getAll() {
  return FALLBACK_DISHES;
}

function getById(id) {
  for (let i = 0; i < FALLBACK_DISHES.length; i++) {
    if (FALLBACK_DISHES[i].id === id) return FALLBACK_DISHES[i];
  }
  return null;
}

function getByCuisine(cuisine) {
  return FALLBACK_DISHES.filter(function (d) { return d.cuisine === cuisine; });
}

module.exports = {
  FALLBACK_DISHES: FALLBACK_DISHES,
  CATEGORY_ORDER: CATEGORY_ORDER,
  getById: getById,
  getByCuisine: getByCuisine,
  getAll: getAll
};
