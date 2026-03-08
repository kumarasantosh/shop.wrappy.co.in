-- Idempotent menu seed for Wrappy.
-- You can rerun safely: category/product rows are inserted only if missing.

with seed_categories(name, position) as (
  values
    ('Thickshakes', 1),
    ('Mojitos', 2),
    ('Wraps', 3),
    ('Fries & Sides', 4),
    ('UFO Specials', 5)
)
insert into categories (name, position)
select sc.name, sc.position
from seed_categories sc
where not exists (
  select 1 from categories c where lower(c.name) = lower(sc.name)
);

with category_map as (
  select id, name from categories
),
seed_products(name, description, price, is_veg, category_name) as (
  values
    -- THICKSHAKES
    ('Butterscotch Banana', 'Creamy shake with butterscotch and banana blend', 99, true, 'Thickshakes'),
    ('Oreo', 'Rich chocolatey Oreo thickshake', 129, true, 'Thickshakes'),
    ('Hard Rock Coffee', 'Strong coffee thickshake with smooth finish', 129, true, 'Thickshakes'),
    ('Kitkat', 'Chunky Kitkat shake with chocolate drizzle', 139, true, 'Thickshakes'),
    ('Protein', 'High-protein power thickshake', 139, true, 'Thickshakes'),
    ('Belgian Chocolate', 'Premium Belgian chocolate thickshake', 139, true, 'Thickshakes'),
    ('Nutella', 'Hazelnut Nutella thickshake', 149, true, 'Thickshakes'),

    -- MOJITOS
    ('Blue Heaven', 'Refreshing blue citrus mojito', 99, true, 'Mojitos'),
    ('Virgin Mojito', 'Classic lime and mint cooler', 99, true, 'Mojitos'),
    ('Mint Mojito', 'Extra mint cooling mojito', 99, true, 'Mojitos'),
    ('Grilled Pineapple Mojito', 'Sweet grilled pineapple with mint fizz', 99, true, 'Mojitos'),
    ('Watermelon Mojito', 'Fresh watermelon mint cooler', 99, true, 'Mojitos'),

    -- WRAPS (VEG)
    ('Classic Veggie', 'Loaded veggie wrap with house sauce', 99, true, 'Wraps'),
    ('Butter Garlic Mushroom', 'Mushroom wrap tossed in butter garlic', 129, true, 'Wraps'),
    ('Crispy Paneer', 'Crunchy paneer wrap with crunchy veggies', 129, true, 'Wraps'),
    ('Cheesy Paneer', 'Paneer wrap with melted cheese', 149, true, 'Wraps'),

    -- WRAPS (CHICKEN)
    ('Crispy Chicken', 'Crispy chicken wrap with signature sauce', 129, false, 'Wraps'),
    ('Chilli Chicken', 'Spicy chilli chicken wrap', 129, false, 'Wraps'),
    ('Smoky Tandoori Chicken', 'Smoky tandoori chicken wrap', 129, false, 'Wraps'),
    ('Cheesy Mexican Chicken', 'Mexican-spiced chicken wrap with cheese', 149, false, 'Wraps'),
    ('Fully Loaded Chicken Wrap', 'Loaded chicken wrap with sauces and crunch', 149, false, 'Wraps'),

    -- FRIES & SIDES
    ('Classic Crispy Fries', 'Salted golden crispy fries', 99, true, 'Fries & Sides'),
    ('Peri Peri Fries', 'Fries tossed in peri peri seasoning', 99, true, 'Fries & Sides'),
    ('Signature Mixed Fries', 'Loaded mixed-style signature fries', 149, true, 'Fries & Sides'),
    ('Golden Chicken Nuggets', 'Crispy golden chicken nuggets', 99, false, 'Fries & Sides'),
    ('Crispy Chicken Strips', 'Crunchy seasoned chicken strips', 129, false, 'Fries & Sides'),
    ('Chicken-Loaded Crispy Fries', 'Crispy fries topped with chicken', 149, false, 'Fries & Sides'),
    ('Cheesy Loaded Fries', 'Fries loaded with rich cheese sauce', 149, true, 'Fries & Sides'),

    -- UFO SPECIALS
    ('Crispy Veg UFO', 'Crispy veg-stuffed UFO pocket', 89, true, 'UFO Specials'),
    ('Paneer / Mushroom UFO', 'Choice of paneer or mushroom UFO', 99, true, 'UFO Specials'),
    ('Chicken UFO', 'Juicy chicken-stuffed UFO pocket', 99, false, 'UFO Specials'),
    ('Zinger Chicken UFO', 'Spicy zinger-style chicken UFO', 129, false, 'UFO Specials'),
    ('Cheese Burst UFO', 'Cheese-filled burst UFO pocket', 129, true, 'UFO Specials'),
    ('Nutella Ice Cream UFO', 'Dessert UFO with Nutella and ice cream', 110, true, 'UFO Specials')
)
insert into products (name, description, price, is_veg, is_available, category_id, image_url, addons)
select
  sp.name,
  sp.description,
  sp.price,
  sp.is_veg,
  true,
  cm.id,
  null,
  '[]'::jsonb
from seed_products sp
join category_map cm on lower(cm.name) = lower(sp.category_name)
where not exists (
  select 1
  from products p
  join categories c on c.id = p.category_id
  where lower(p.name) = lower(sp.name)
    and lower(c.name) = lower(sp.category_name)
);

insert into coupons (code, type, value, min_order, usage_limit, used_count, expires_at, is_active)
values
  ('WELCOME10', 'percent', 10, 0, 1000, 0, now() + interval '180 days', true),
  ('FLAT120', 'flat', 120, 699, 250, 0, now() + interval '90 days', true),
  ('FIRST50', 'first_order', 50, 399, 1000, 0, now() + interval '180 days', true)
on conflict (code) do nothing;

insert into store_settings (open_time, close_time, allow_preorder, force_closed, estimated_delivery_minutes)
select '10:00:00', '23:00:00', true, false, 30
where not exists (select 1 from store_settings);
