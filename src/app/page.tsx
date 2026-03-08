"use client";
import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import FloatingCartButton from "../components/CartButton";
import ProductCard, { Product } from "../components/ProductCard";
import {
  getDefaultStoreSettings,
  getNextOpeningTime,
  isStoreOpenNow,
  normalizeStoreSettings,
} from "../lib/storeStatus";
import {
  CategoryRecord,
  ProductRecord,
  StoreSettingsRecord,
} from "../lib/types";

function mapProduct(record: ProductRecord): Product {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    price: Number(record.price),
    isVeg: Boolean(record.is_veg),
    isAvailable: record.is_available !== false,
    image: record.image_url,
    category: record.category?.name || "",
    addons: record.addons || [],
  };
}

export default function HomePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [settings, setSettings] = useState<StoreSettingsRecord>(
    getDefaultStoreSettings(),
  );
  const [storeOpen, setStoreOpen] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [vegOnly, setVegOnly] = useState(false);

  useEffect(() => {
    async function loadData() {
      const [productsRes, categoriesRes, settingsRes] = await Promise.all([
        fetch("/api/products").then((response) => response.json()),
        fetch("/api/categories").then((response) => response.json()),
        fetch("/api/store-settings").then((response) => response.json()),
      ]);

      const mappedProducts = (productsRes.products || []).map(
        (record: ProductRecord) => mapProduct(record),
      );
      setProducts(mappedProducts);
      setCategories((categoriesRes.categories || []) as CategoryRecord[]);
      const normalizedSettings = normalizeStoreSettings(
        settingsRes as Partial<StoreSettingsRecord>,
      );
      setSettings(normalizedSettings);
      setStoreOpen(isStoreOpenNow(normalizedSettings));
    }

    loadData().catch(() => {});
  }, []);

  useEffect(() => {
    const interval = setInterval(
      () => setStoreOpen(isStoreOpenNow(settings)),
      30_000,
    );
    return () => clearInterval(interval);
  }, [settings]);

  const dedupedProducts = useMemo(() => {
    const byKey = new Map<string, Product>();

    for (const product of products) {
      const key = `${product.name.trim().toLowerCase()}::${(
        product.category || ""
      )
        .trim()
        .toLowerCase()}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, product);
        continue;
      }

      const existingScore =
        (existing.image ? 3 : 0) +
        (existing.description?.length || 0) +
        (existing.addons?.length || 0);
      const incomingScore =
        (product.image ? 3 : 0) +
        (product.description?.length || 0) +
        (product.addons?.length || 0);

      if (incomingScore > existingScore) {
        byKey.set(key, product);
      }
    }

    return Array.from(byKey.values());
  }, [products]);

  const dedupedCategories = useMemo(() => {
    const byName = new Map<string, string>();
    for (const entry of categories) {
      const normalized = entry.name.trim().toLowerCase();
      if (!normalized || byName.has(normalized)) continue;
      byName.set(normalized, entry.name);
    }
    return Array.from(byName.values());
  }, [categories]);

  const availableCategories = useMemo(
    () => ["All", ...dedupedCategories],
    [dedupedCategories],
  );
  const canOrder = !settings.force_closed && (storeOpen || settings.allow_preorder);
  const closedMessage = getNextOpeningTime(settings);

  const filtered = useMemo(
    () =>
      dedupedProducts.filter((product) => {
        if (category !== "All" && product.category !== category) return false;
        if (vegOnly && !product.isVeg) return false;
        if (
          search &&
          !product.name.toLowerCase().includes(search.trim().toLowerCase())
        ) {
          return false;
        }
        return true;
      }),
    [dedupedProducts, category, vegOnly, search],
  );

  return (
    <div className="space-y-8 py-6">
      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        className="overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-br from-[#1A1A1A] via-[#121212] to-[#0f0f0f]"
      >
        <div className="flex flex-col gap-8 p-8 md:flex-row md:items-center md:p-12">
          <div className="flex-1 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`rounded-full px-3 py-1 text-xs font-bold ${
                  storeOpen
                    ? "bg-green-500/15 text-green-400"
                    : "bg-red-500/15 text-red-400"
                }`}
              >
                {storeOpen ? "● Open Now" : "● Closed"}
              </span>
              <span className="text-sm text-gray-500">⭐ 4.8 • 25-35 min</span>
            </div>
            <h1 className="text-4xl font-bold leading-tight md:text-5xl">
              Wrappy
              <span className="mt-2 block text-lg font-normal text-gray-400 md:text-xl">
                Premium comfort food for your evenings
              </span>
            </h1>
            {!storeOpen && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4">
                <p className="text-sm font-medium text-red-300">
                  Store closed right now. {closedMessage}
                  {!settings.force_closed && settings.allow_preorder
                    ? " Pre-orders are enabled."
                    : " Orders are paused."}
                </p>
              </div>
            )}
          </div>

          <div className="h-56 w-full overflow-hidden rounded-2xl md:w-80">
            <img
              src="https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1200&q=80"
              alt="Restaurant hero"
              className="h-full w-full object-cover"
            />
          </div>
        </div>
      </motion.section>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500">
            🔍
          </span>
          <input
            type="text"
            placeholder="Search dishes..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full rounded-xl border border-white/10 bg-[#181818] py-3 pl-11 pr-4 text-sm text-white placeholder:text-gray-600"
          />
        </div>
        <button
          onClick={() => setVegOnly((value) => !value)}
          className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition-colors ${
            vegOnly
              ? "border-green-500/30 bg-green-500/10 text-green-400"
              : "border-white/10 bg-[#181818] text-gray-400"
          }`}
        >
          <span className="h-3 w-3 rounded-full bg-green-500" />
          Pure Veg
        </button>
      </div>

      <div className="hide-scrollbar flex gap-2 overflow-x-auto pb-2">
        {availableCategories.map((name, index) => (
          <button
            key={`${name}-${index}`}
            onClick={() => setCategory(name)}
            className={`flex-shrink-0 rounded-full px-5 py-2 text-sm font-medium transition-all ${
              category === name
                ? "bg-white text-black"
                : "border border-white/10 bg-[#181818] text-gray-400 hover:text-white"
            }`}
          >
            {name}
          </button>
        ))}
      </div>

      <section>
        <h2 className="mb-4 text-xl font-semibold">
          {category === "All" ? "Featured Dishes" : category}
          <span className="ml-2 text-sm font-normal text-gray-500">
            ({filtered.length})
          </span>
        </h2>

        {filtered.length === 0 ? (
          <div className="py-16 text-center text-gray-600">
            <p className="mb-4 text-4xl">🍽️</p>
            <p>No dishes found for this filter.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                disabled={!canOrder || product.isAvailable === false}
                disabledTitle={
                  !canOrder ? "Store Closed" : "Currently not available"
                }
                disabledReason={!canOrder ? closedMessage : undefined}
              />
            ))}
          </div>
        )}
      </section>

      <FloatingCartButton />
    </div>
  );
}
