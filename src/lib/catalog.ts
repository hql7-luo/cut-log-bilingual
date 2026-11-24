import type { FoodSpec, Nutrition } from "./model.ts";
import { normalize, nutrition, scale, sum } from "./nutrition.ts";

// USDA SR Legacy reference values per 100 g of the specified preparation.
function reference(
  name: string, aliases: string[], category: FoodSpec["category"], fdcId: number,
  base: Nutrition, defaultAmount: number, defaultUnit: string, portions: Record<string, number> = {}, note?: string,
): FoodSpec {
  return { name, aliases, category, fdcId, base, defaultAmount, defaultUnit, portions, note, basisGrams: 100, source: "usda-reference" };
}

const rice = reference("白米饭", ["米饭", "白饭", "熟米饭", "rice", "white rice", "cooked rice"], "主食", 168878,
  nutrition(130, 2.69, 28.17, 0.28), 1, "碗", { 碗: 150, 杯: 158, 份: 150 }, "熟重。小碗以 150 g 估算。");
const noodles = reference("面条（熟）", ["面", "面条", "熟面条", "pasta", "plain noodles", "noodles"], "主食", 169737,
  nutrition(158, 5.8, 30.86, 0.93), 1, "碗", { 碗: 180, 份: 180, 杯: 124 }, "按熟小麦面参考值。汤、油、肉和浇头可另外记录。");
const chicken = reference("鸡胸肉（熟）", ["鸡胸肉", "熟鸡胸肉", "烤鸡胸肉", "鸡胸", "chicken breast", "roasted chicken breast", "cooked chicken breast"], "蛋白质", 171477,
  nutrition(165, 31.02, 0, 3.57), 150, "g", { 块: 86, 份: 150 }, "去皮烤鸡胸的熟重。若称的是生重，可选生鸡胸肉。");
const rawChicken = reference("生鸡胸肉", ["raw chicken breast", "鸡胸肉生重", "生的鸡胸肉"], "蛋白质", 171077,
  nutrition(120, 22.5, 0, 2.62), 150, "g", { 块: 150, 份: 150 }, "按去皮鸡胸肉的生重。");
const egg = reference("鸡蛋", ["煮鸡蛋", "水煮蛋", "蛋", "egg", "eggs", "boiled egg", "boiled eggs"], "蛋白质", 173424,
  nutrition(155, 12.58, 1.12, 10.61), 1, "个", { 个: 50, 颗: 50, 份: 50 }, "按水煮全蛋的去壳重量。炒蛋或煎蛋的油可另记。");
const banana = reference("香蕉", ["banana", "bananas"], "蔬果", 173944,
  nutrition(89, 1.09, 22.84, 0.33), 1, "根", { 根: 118, 个: 118, 份: 118 }, "按去皮可食部。");
const apple = reference("苹果", ["带皮苹果", "apple", "apples"], "蔬果", 171688,
  nutrition(52, 0.26, 13.81, 0.17), 1, "个", { 个: 182, 颗: 182, 份: 182 }, "按生鲜带皮可食部。一个中等苹果约 182 g。");
const oats = reference("燕麦片（干）", ["燕麦片", "燕麦", "干燕麦", "rolled oats", "oats"], "主食", 173904,
  nutrition(379, 13.15, 67.7, 6.52), 40, "g", { 碗: 40, 份: 40, 杯: 80 }, "按煮之前的干重。");

// Recipe estimates use visible portion, oil and sauce assumptions.
function recipe(name: string, aliases: string[], category: FoodSpec["category"], defaultUnit: string,
  basisGrams: number | null, low: Nutrition, high: Nutrition, note: string, portions: Record<string, number> = {},
): FoodSpec {
  return { name, aliases, category, source: "estimate", base: scale(sum([low, high]), 0.5),
    bounds: { low, high }, basisGrams, defaultUnit, defaultAmount: 1, portions, note };
}

const beef = nutrition(210, 26, 0, 11);
const oil = nutrition(9, 0, 0, 1);
const oilyVeg = nutrition(40, 2, 7, 0.5);
const sauce = nutrition(30, 1, 6, 0.2);
const stirBeef = recipe("炒牛肉", ["小炒牛肉", "青椒牛肉", "牛肉炒菜", "beef stir fry", "stir-fried beef"], "餐馆", "份", 230,
  sum([scale(beef, 0.95), scale(oilyVeg, 0.65), scale(oil, 5), scale(sauce, 0.5)]),
  sum([scale(beef, 1.65), oilyVeg, scale(oil, 23), scale(sauce, 1.5)]),
  "每份约 95–165 g 熟牛肉、5–23 g 炒油，另计配菜与酱料。用油和肥瘦影响最大。", { 碗: 230, 盘: 230 });
const ramen = recipe("牛肉拉面", ["牛肉面", "兰州拉面", "兰州牛肉拉面", "beef noodle soup", "beef ramen"], "餐馆", "碗", 520,
  sum([scale(noodles.base, 1.55), scale(beef, 0.45), scale(oil, 3), sauce]),
  sum([scale(noodles.base, 2.9), scale(beef, 1.1), scale(oil, 16), scale(sauce, 1.6)]),
  "每碗约 155–290 g 熟面、45–110 g 牛肉、3–16 g 油，包含汤底和酱料。少喝汤时可下调。", { 碗: 520, 份: 520 });
const friedRice = recipe("炒饭", ["蛋炒饭", "fried rice", "egg fried rice"], "餐馆", "份", 340,
  sum([scale(rice.base, 1.8), scale(egg.base, 0.5), scale(oil, 5), scale(sauce, 0.5)]),
  sum([scale(rice.base, 3), scale(egg.base, 0.9), scale(oil, 24), sauce]),
  "按熟米饭、鸡蛋、炒油与酱料估算。肉类、餐馆大份与额外用油可另行调整。", { 碗: 340, 盘: 340 });
const whey = recipe("乳清蛋白粉", ["蛋白粉", "乳清", "乳清粉", "whey", "whey protein", "protein powder"], "补剂", "勺", 30,
  nutrition(100, 20, 1, 0.5), nutrition(150, 29, 7, 4),
  "按每勺约 30 g 的普通乳清估算。不同品牌差异较大，建议录入自己的包装标签。", { 勺: 30, 份: 30 });
const creatine: FoodSpec = {
  name: "纯肌酸", aliases: ["肌酸", "creatine", "creatine monohydrate"], category: "补剂",
  source: "estimate", base: nutrition(0, 0, 0, 0), basisGrams: 5, defaultUnit: "勺", defaultAmount: 1,
  portions: { 勺: 5, 份: 5 }, note: "按无糖、无混合成分的纯肌酸记录。调味或复合产品以包装为准。",
};
const croissant = recipe("可颂", ["牛角包", "羊角包", "croissant"], "主食", "个", 60,
  nutrition(190, 3, 20, 9), nutrition(310, 7, 35, 18), "普通黄油可颂的大小与配方有差异。夹馅款以标签为准。", { 个: 60, 份: 60 });
const broccoli = recipe("熟西兰花", ["西兰花", "broccoli", "steamed broccoli"], "蔬果", "份", 100,
  nutrition(28, 1.8, 5, 0.2), nutrition(42, 3, 9, 0.7), "按清蒸或水煮 100 g，炒油与酱料另记。", { 碗: 100, 份: 100 });
const oilSpec: FoodSpec = {
  name: "食用油", aliases: ["油", "炒油", "橄榄油", "cooking oil", "olive oil", "oil"],
  category: "其他", source: "estimate", base: scale(oil, 100), basisGrams: 100,
  defaultUnit: "g", defaultAmount: 5, portions: { 茶匙: 4.5, 大勺: 13.5 },
  note: "按脂肪 9 kcal/g 估算。已使用含油的整菜估算时，只另记额外的油。",
};
const friedChicken = recipe("炸鸡", ["fried chicken", "炸鸡块", "chicken tenders"], "餐馆", "份", 160,
  nutrition(300, 21, 15, 16), nutrition(530, 38, 34, 31), "按约 160 g 可食部估算。裹粉、部位、吸油和蘸酱会影响营养。", { 块: 80, 份: 160 });

export const CATALOG: FoodSpec[] = [rice, egg, chicken, noodles, stirBeef, ramen, whey, banana, oats, apple,
  broccoli, croissant, friedRice, friedChicken, rawChicken, creatine, oilSpec];

export function searchCatalog(query: string, foods: FoodSpec[] = CATALOG) {
  const needle = normalize(query);
  if (!needle) return foods;
  return foods.filter((spec) => [spec.name, ...spec.aliases].some((alias) => normalize(alias).includes(needle)));
}

export function exactFood(name: string, foods: FoodSpec[]) {
  const needle = normalize(name);
  return foods.find((spec) => [spec.name, ...spec.aliases].some((alias) => normalize(alias) === needle));
}
