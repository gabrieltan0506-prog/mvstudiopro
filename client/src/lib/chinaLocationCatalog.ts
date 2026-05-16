/**
 * 省／直轄市 + 下級節點：普通省為地級市；直轄市為「區」級（如北京市—朝陽區、上海市—浦東新區）。
 * 座標為區縣中心近似值，供 Open‑Meteo 天氣與路況關鍵字使用。
 */

export type ChinaPlace = { name: string; lat: number; lon: number };
/** @deprecated 與 ChinaPlace 同義，保留別名以免舊引用報錯 */
export type ChinaCity = ChinaPlace;
export type ChinaProvince = { id: string; name: string; cities: ChinaPlace[] };

export const CHINA_PROVINCES: ChinaProvince[] = [
  {
    id: "bj",
    name: "北京市",
    cities: [
      { name: "东城区", lat: 39.9289, lon: 116.4166 },
      { name: "西城区", lat: 39.9123, lon: 116.3668 },
      { name: "朝阳区", lat: 39.9219, lon: 116.4435 },
      { name: "丰台区", lat: 39.8585, lon: 116.2868 },
      { name: "石景山区", lat: 39.9066, lon: 116.2229 },
      { name: "海淀区", lat: 39.9599, lon: 116.2982 },
      { name: "门头沟区", lat: 39.9404, lon: 116.1054 },
      { name: "房山区", lat: 39.7355, lon: 116.1392 },
      { name: "通州区", lat: 39.9025, lon: 116.6564 },
      { name: "顺义区", lat: 40.1498, lon: 116.6545 },
      { name: "昌平区", lat: 40.2208, lon: 116.2312 },
      { name: "大兴区", lat: 39.7269, lon: 116.338 },
      { name: "怀柔区", lat: 40.316, lon: 116.632 },
      { name: "平谷区", lat: 40.1406, lon: 117.1214 },
      { name: "密云区", lat: 40.376, lon: 116.8434 },
      { name: "延庆区", lat: 40.4653, lon: 115.985 },
    ],
  },
  {
    id: "tj",
    name: "天津市",
    cities: [
      { name: "和平区", lat: 39.1171, lon: 117.1959 },
      { name: "河东区", lat: 39.1283, lon: 117.2516 },
      { name: "河西区", lat: 39.1095, lon: 117.2232 },
      { name: "南开区", lat: 39.1205, lon: 117.1507 },
      { name: "河北区", lat: 39.1478, lon: 117.1969 },
      { name: "红桥区", lat: 39.1677, lon: 117.1516 },
      { name: "东丽区", lat: 39.0863, lon: 117.314 },
      { name: "西青区", lat: 39.1412, lon: 117.0082 },
      { name: "津南区", lat: 38.9914, lon: 117.3854 },
      { name: "北辰区", lat: 39.224, lon: 117.1355 },
      { name: "武清区", lat: 39.3769, lon: 117.044 },
      { name: "宝坻区", lat: 39.717, lon: 117.3081 },
      { name: "滨海新区", lat: 39.0032, lon: 117.7108 },
      { name: "宁河区", lat: 39.3289, lon: 117.8247 },
    ],
  },
  {
    id: "he",
    name: "河北省",
    cities: [
      { name: "石家庄市", lat: 38.0428, lon: 114.5149 },
      { name: "唐山市", lat: 39.6309, lon: 118.1802 },
      { name: "保定市", lat: 38.8673, lon: 115.4845 },
      { name: "秦皇岛市", lat: 39.8883, lon: 119.5202 },
      { name: "邯郸市", lat: 36.6257, lon: 114.5388 },
    ],
  },
  {
    id: "sx",
    name: "山西省",
    cities: [
      { name: "太原市", lat: 37.8706, lon: 112.5489 },
      { name: "大同市", lat: 40.0768, lon: 113.3001 },
      { name: "运城市", lat: 35.0264, lon: 111.0075 },
    ],
  },
  {
    id: "nm",
    name: "内蒙古自治区",
    cities: [
      { name: "呼和浩特市", lat: 40.8424, lon: 111.7519 },
      { name: "包头市", lat: 40.6562, lon: 109.8403 },
      { name: "鄂尔多斯市", lat: 39.6083, lon: 109.7813 },
    ],
  },
  {
    id: "ln",
    name: "辽宁省",
    cities: [
      { name: "沈阳市", lat: 41.8057, lon: 123.4328 },
      { name: "大连市", lat: 38.914, lon: 121.6147 },
      { name: "鞍山市", lat: 41.1085, lon: 122.9945 },
    ],
  },
  {
    id: "jl",
    name: "吉林省",
    cities: [
      { name: "长春市", lat: 43.8171, lon: 125.3235 },
      { name: "吉林市", lat: 43.8436, lon: 126.5496 },
    ],
  },
  {
    id: "hlj",
    name: "黑龙江省",
    cities: [
      { name: "哈尔滨市", lat: 45.8038, lon: 126.5349 },
      { name: "齐齐哈尔市", lat: 47.3543, lon: 123.9182 },
      { name: "大庆市", lat: 46.5876, lon: 125.1031 },
    ],
  },
  {
    id: "sh",
    name: "上海市",
    cities: [
      { name: "黄浦区", lat: 31.2317, lon: 121.4844 },
      { name: "徐汇区", lat: 31.1803, lon: 121.4365 },
      { name: "长宁区", lat: 31.2181, lon: 121.4228 },
      { name: "静安区", lat: 31.2235, lon: 121.4558 },
      { name: "普陀区", lat: 31.2478, lon: 121.3925 },
      { name: "虹口区", lat: 31.2646, lon: 121.505 },
      { name: "杨浦区", lat: 31.2595, lon: 121.526 },
      { name: "闵行区", lat: 31.1132, lon: 121.382 },
      { name: "宝山区", lat: 31.4053, lon: 121.4891 },
      { name: "嘉定区", lat: 31.3756, lon: 121.2511 },
      { name: "浦东新区", lat: 31.2215, lon: 121.5441 },
      { name: "金山区", lat: 30.7413, lon: 121.3417 },
      { name: "松江区", lat: 31.0322, lon: 121.2277 },
      { name: "青浦区", lat: 31.1497, lon: 121.1242 },
      { name: "奉贤区", lat: 30.9179, lon: 121.4741 },
      { name: "崇明区", lat: 31.6231, lon: 121.3975 },
    ],
  },
  {
    id: "js",
    name: "江苏省",
    cities: [
      { name: "南京市", lat: 32.0603, lon: 118.7969 },
      { name: "苏州市", lat: 31.2989, lon: 120.5853 },
      { name: "无锡市", lat: 31.4912, lon: 120.3119 },
      { name: "常州市", lat: 31.8107, lon: 119.9739 },
      { name: "南通市", lat: 31.9796, lon: 120.9 },
      { name: "徐州市", lat: 34.2044, lon: 117.2858 },
      { name: "扬州市", lat: 32.3942, lon: 119.4129 },
      { name: "盐城市", lat: 33.3577, lon: 120.1572 },
    ],
  },
  {
    id: "zj",
    name: "浙江省",
    cities: [
      { name: "杭州市", lat: 30.2741, lon: 120.1551 },
      { name: "宁波市", lat: 29.8683, lon: 121.544 },
      { name: "温州市", lat: 28.0006, lon: 120.6994 },
      { name: "嘉兴市", lat: 30.7522, lon: 120.7555 },
      { name: "绍兴市", lat: 30.0298, lon: 120.582 },
      { name: "金华市", lat: 29.0792, lon: 119.6475 },
    ],
  },
  {
    id: "ah",
    name: "安徽省",
    cities: [
      { name: "合肥市", lat: 31.8206, lon: 117.2272 },
      { name: "芜湖市", lat: 31.3526, lon: 118.4331 },
      { name: "黄山市", lat: 29.7147, lon: 118.337 },
    ],
  },
  {
    id: "fj",
    name: "福建省",
    cities: [
      { name: "福州市", lat: 26.0745, lon: 119.2965 },
      { name: "厦门市", lat: 24.4798, lon: 118.0819 },
      { name: "泉州市", lat: 24.8741, lon: 118.6758 },
      { name: "漳州市", lat: 24.513, lon: 117.647 },
    ],
  },
  {
    id: "jx",
    name: "江西省",
    cities: [
      { name: "南昌市", lat: 28.684, lon: 115.8579 },
      { name: "九江市", lat: 29.7051, lon: 116.0019 },
      { name: "赣州市", lat: 25.8307, lon: 114.9336 },
    ],
  },
  {
    id: "sd",
    name: "山东省",
    cities: [
      { name: "济南市", lat: 36.6512, lon: 117.12 },
      { name: "青岛市", lat: 36.0671, lon: 120.3826 },
      { name: "烟台市", lat: 37.4638, lon: 121.4479 },
      { name: "潍坊市", lat: 36.7067, lon: 119.1078 },
    ],
  },
  {
    id: "ha",
    name: "河南省",
    cities: [
      { name: "郑州市", lat: 34.7466, lon: 113.6254 },
      { name: "洛阳市", lat: 34.6197, lon: 112.4539 },
      { name: "开封市", lat: 34.7971, lon: 114.3074 },
    ],
  },
  {
    id: "hb",
    name: "湖北省",
    cities: [
      { name: "武汉市", lat: 30.5928, lon: 114.3055 },
      { name: "宜昌市", lat: 30.6919, lon: 111.2865 },
      { name: "襄阳市", lat: 32.0089, lon: 112.1224 },
    ],
  },
  {
    id: "hn",
    name: "湖南省",
    cities: [
      { name: "长沙市", lat: 28.228, lon: 112.9388 },
      { name: "株洲市", lat: 27.8279, lon: 113.1339 },
      { name: "张家界市", lat: 29.1274, lon: 110.4792 },
    ],
  },
  {
    id: "gd",
    name: "广东省",
    cities: [
      { name: "广州市", lat: 23.1291, lon: 113.2644 },
      { name: "深圳市", lat: 22.5431, lon: 114.0579 },
      { name: "珠海市", lat: 22.2709, lon: 113.5767 },
      { name: "佛山市", lat: 23.0215, lon: 113.1219 },
      { name: "东莞市", lat: 23.0207, lon: 113.7518 },
      { name: "汕头市", lat: 23.3541, lon: 116.682 },
    ],
  },
  {
    id: "gx",
    name: "广西壮族自治区",
    cities: [
      { name: "南宁市", lat: 22.817, lon: 108.3665 },
      { name: "桂林市", lat: 25.2736, lon: 110.29 },
    ],
  },
  {
    id: "han",
    name: "海南省",
    cities: [
      { name: "海口市", lat: 20.044, lon: 110.1999 },
      { name: "三亚市", lat: 18.2528, lon: 109.5118 },
    ],
  },
  {
    id: "cq",
    name: "重庆市",
    cities: [
      { name: "渝中区", lat: 29.5528, lon: 106.569 },
      { name: "大渡口区", lat: 29.4845, lon: 106.4812 },
      { name: "江北区", lat: 29.6066, lon: 106.5744 },
      { name: "沙坪坝区", lat: 29.5412, lon: 106.4569 },
      { name: "九龙坡区", lat: 29.5023, lon: 106.5111 },
      { name: "南岸区", lat: 29.5217, lon: 106.5635 },
      { name: "北碚区", lat: 29.8254, lon: 106.4379 },
      { name: "渝北区", lat: 29.7182, lon: 106.6312 },
      { name: "巴南区", lat: 29.3831, lon: 106.5403 },
      { name: "涪陵区", lat: 29.7526, lon: 107.3896 },
      { name: "綦江区", lat: 28.9645, lon: 106.9285 },
      { name: "万州区", lat: 30.8079, lon: 108.4087 },
      { name: "两江新区", lat: 29.65, lon: 106.55 },
    ],
  },
  {
    id: "sc",
    name: "四川省",
    cities: [
      { name: "成都市", lat: 30.5728, lon: 104.0668 },
      { name: "绵阳市", lat: 31.4678, lon: 104.679 },
      { name: "乐山市", lat: 29.5522, lon: 103.7656 },
    ],
  },
  {
    id: "gz",
    name: "贵州省",
    cities: [
      { name: "贵阳市", lat: 26.647, lon: 106.6302 },
      { name: "遵义市", lat: 27.705, lon: 106.9274 },
    ],
  },
  {
    id: "yn",
    name: "云南省",
    cities: [
      { name: "昆明市", lat: 25.0389, lon: 102.7183 },
      { name: "大理市", lat: 25.6065, lon: 100.2676 },
    ],
  },
  { id: "xz", name: "西藏自治区", cities: [{ name: "拉萨市", lat: 29.65, lon: 91.1 }] },
  {
    id: "sn",
    name: "陕西省",
    cities: [
      { name: "西安市", lat: 34.3416, lon: 108.9398 },
      { name: "咸阳市", lat: 34.3296, lon: 108.709 },
    ],
  },
  { id: "gs", name: "甘肃省", cities: [{ name: "兰州市", lat: 36.0611, lon: 103.8343 }] },
  { id: "qh", name: "青海省", cities: [{ name: "西宁市", lat: 36.6171, lon: 101.7782 }] },
  { id: "nx", name: "宁夏回族自治区", cities: [{ name: "银川市", lat: 38.4872, lon: 106.2309 }] },
  {
    id: "xj",
    name: "新疆维吾尔自治区",
    cities: [
      { name: "乌鲁木齐市", lat: 43.8256, lon: 87.6168 },
      { name: "喀什市", lat: 39.4704, lon: 75.9897 },
    ],
  },
  { id: "hk", name: "香港特别行政区", cities: [{ name: "香港", lat: 22.3193, lon: 114.1694 }] },
  { id: "mo", name: "澳门特别行政区", cities: [{ name: "澳门", lat: 22.1987, lon: 113.5439 }] },
  {
    id: "tw",
    name: "台湾省",
    cities: [
      { name: "台北市", lat: 25.033, lon: 121.5654 },
      { name: "新北市", lat: 25.017, lon: 121.4628 },
      { name: "桃园市", lat: 24.9936, lon: 121.301 },
      { name: "台中市", lat: 24.1477, lon: 120.6736 },
      { name: "台南市", lat: 22.9999, lon: 120.2269 },
      { name: "高雄市", lat: 22.6273, lon: 120.3014 },
    ],
  },
];

export function findProvinceById(id: string): ChinaProvince | undefined {
  return CHINA_PROVINCES.find((p) => p.id === id);
}
