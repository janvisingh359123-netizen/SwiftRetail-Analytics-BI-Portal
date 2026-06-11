const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
require('dotenv').config();

let dbType = process.env.DB_TYPE || 'postgres';

let pgPool = null;
let sqliteDb = null;

// Initialize Database Connections
function initDb() {
  if (dbType === 'postgres') {
    pgPool = new Pool({
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432'),
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || 'postgres',
      database: process.env.PGDATABASE || 'ecommerce_analytics',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    return pgPool;
  } else {
    const dbPath = path.resolve(process.env.SQLITE_DB_PATH || './ecommerce_analytics.sqlite');
    sqliteDb = new sqlite3.Database(dbPath);
    return sqliteDb;
  }
}

// Check database connection
async function checkConnection() {
  if (dbType === 'postgres') {
    try {
      const client = await pgPool.connect();
      client.release();
      console.log('Successfully connected to PostgreSQL');
      return true;
    } catch (err) {
      console.error('Failed to connect to PostgreSQL:', err.message);
      console.log('Falling back to SQLite database...');
      dbType = 'sqlite';
      process.env.DB_TYPE = 'sqlite';
      initDb();
      return checkConnection();
    }
  } else {
    return new Promise((resolve) => {
      sqliteDb.all('SELECT 1', [], (err) => {
        if (err) {
          console.error('Failed to connect to SQLite:', err.message);
          resolve(false);
        } else {
          console.log('Successfully connected to SQLite at:', process.env.SQLITE_DB_PATH);
          resolve(true);
        }
      });
    });
  }
}

// Execute general query (works for both PG and SQLite)
function query(text, params = []) {
  const currentDbType = process.env.DB_TYPE || 'postgres';
  if (currentDbType === 'postgres') {
    return pgPool.query(text, params);
  } else {
    // Convert PostgreSQL parameters ($1, $2, ...) to SQLite parameters (?, ?, ...)
    let sqliteText = text;
    // Simple replacement: replace $1, $2, etc. with ?
    sqliteText = sqliteText.replace(/\$\d+/g, '?');

    // Handle standard SQL Dialect differences
    sqliteText = sqliteText.replace(/SERIAL PRIMARY KEY/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT');
    sqliteText = sqliteText.replace(/DECIMAL\(\d+,\s*\d+\)/gi, 'NUMERIC');

    return new Promise((resolve, reject) => {
      const isSelect = sqliteText.trim().match(/^(select|with|show|pragma)/i);
      if (isSelect) {
        sqliteDb.all(sqliteText, params, (err, rows) => {
          if (err) reject(err);
          else resolve({ rows, rowCount: rows.length });
        });
      } else {
        sqliteDb.run(sqliteText, params, function (err) {
          if (err) reject(err);
          else resolve({ rows: [], rowCount: this.changes, lastID: this.lastID });
        });
      }
    });
  }
}

// Run schema setup from schema.sql
async function setupSchema() {
  console.log('Running database migrations/schema setup...');
  const schemaPath = path.join(__dirname, 'schema.sql');
  let schemaSql = fs.readFileSync(schemaPath, 'utf8');
  const currentDbType = process.env.DB_TYPE || 'postgres';

  if (currentDbType === 'postgres') {
    // Run schemaSql as one block
    await query(schemaSql);
  } else {
    // SQLite: Split schema commands by semicolon
    // We also need to map some Postgres details to SQLite
    schemaSql = schemaSql.replace(/SERIAL PRIMARY KEY/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT');
    schemaSql = schemaSql.replace(/DECIMAL\(\d+,\s*\d+\)/gi, 'NUMERIC');
    schemaSql = schemaSql.replace(/ON DELETE CASCADE/gi, ''); 
    schemaSql = schemaSql.replace(/REFERENCES \w+\(\w+\)/gi, ''); 
    schemaSql = schemaSql.replace(/CASCADE/gi, '');

    const commands = schemaSql
      .split(';')
      .map(c => c.trim())
      .filter(c => {
        // Strip SQL comments to check if there is actual code to execute
        const clean = c.replace(/--.*$/gm, '').trim();
        return clean.length > 0;
      });

    for (const cmd of commands) {
      await query(cmd);
    }
  }
  console.log('Database schema created successfully.');
}

// Mock Data Arrays
const firstNames = ['John', 'Emma', 'Liam', 'Olivia', 'Noah', 'Ava', 'Oliver', 'Sophia', 'Elijah', 'Isabella', 'James', 'Charlotte', 'William', 'Amelia', 'Benjamin', 'Mia', 'Lucas', 'Harper', 'Henry', 'Evelyn', 'Aarav', 'Ananya', 'Rohan', 'Priya', 'Aditya', 'Sneha', 'Rahul', 'Neha', 'Vikram', 'Kavya', 'Thomas', 'Sophie', 'Alex', 'Marie', 'Lukas', 'Laura', 'David', 'Sarah', 'Michael', 'Emily'];
const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Sharma', 'Patel', 'Kumar', 'Singh', 'Joshi', 'Mehta', 'Taylor', 'Anderson', 'Thomas', 'Jackson', 'White', 'Harris', 'Martin', 'Thompson', 'Muller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer', 'Jones', 'Evans', 'Davies', 'Taylor', 'Wilson'];
const genders = ['Male', 'Female', 'Non-binary', 'Prefer not to say'];
const domains = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'ecommerce-hub.org'];

const regionalData = [
  { country: 'United States', state: 'California', cities: ['Los Angeles', 'San Francisco', 'San Diego', 'San Jose'] },
  { country: 'United States', state: 'New York', cities: ['New York City', 'Buffalo', 'Rochester', 'Syracuse'] },
  { country: 'United States', state: 'Texas', cities: ['Houston', 'Austin', 'Dallas', 'San Antonio'] },
  { country: 'United States', state: 'Florida', cities: ['Miami', 'Orlando', 'Tampa', 'Jacksonville'] },
  { country: 'United States', state: 'Washington', cities: ['Seattle', 'Tacoma', 'Spokane'] },
  { country: 'India', state: 'Maharashtra', cities: ['Mumbai', 'Pune', 'Nagpur', 'Thane'] },
  { country: 'India', state: 'Karnataka', cities: ['Bangalore', 'Mysore', 'Hubli'] },
  { country: 'India', state: 'Delhi', cities: ['New Delhi', 'Dwarka', 'Rohini'] },
  { country: 'India', state: 'Tamil Nadu', cities: ['Chennai', 'Coimbatore', 'Madurai'] },
  { country: 'India', state: 'Telangana', cities: ['Hyderabad', 'Secunderabad', 'Warangal'] },
  { country: 'United Kingdom', state: 'England', cities: ['London', 'Manchester', 'Birmingham', 'Leeds', 'Liverpool'] },
  { country: 'Germany', state: 'Bavaria', cities: ['Munich', 'Nuremberg', 'Augsburg'] },
  { country: 'Germany', state: 'Berlin', cities: ['Berlin'] },
  { country: 'Germany', state: 'Hamburg', cities: ['Hamburg'] }
];

const categoryData = {
  'Electronics': {
    subcategories: ['Audio', 'Computers', 'Mobile', 'Wearables'],
    products: ['Wireless Headphones', 'Gaming Keyboard', 'Bluetooth Speaker', 'Smartwatch Series 5', 'Noise Cancelling Earbuds', 'LED Monitor 27\"', 'USB-C Charging Dock', 'Ultra-thin Laptop Pro', '4K Action Camera', 'Tablet 10-inch', 'External SSD 1TB', 'Mechanical Keyboard', 'Ergonomic Wireless Mouse', 'Portable Power Bank', 'Smart Home Hub', 'VR Headset Extreme', 'Wireless Charging Pad', 'HD Webcam 1080p', 'Dual-Band Router', 'Noise-Cancelling Mic']
  },
  'Fashion': {
    subcategories: ['Men\'s Wear', 'Women\'s Wear', 'Footwear', 'Accessories'],
    products: ['Slim Fit Blue Jeans', 'Classic White T-Shirt', 'Leather Bomber Jacket', 'Running Sneakers', 'Canvas Tote Bag', 'Woolen Winter Scarf', 'Polarized Sunglasses', 'Designer Leather Belt', 'Denim Jacket Classic', 'Athletic Gym Shorts', 'Summer Floral Dress', 'Cotton Crew Socks', 'Suede Chelsea Boots', 'Activewear Leggings', 'Quartz Wrist Watch', 'Fleece Pullover Hoodie', 'Silk Evening Scarf', 'Leather Wallet Bi-fold', 'Straw Sun Hat', 'Casual Linen Shirt']
  },
  'Home & Kitchen': {
    subcategories: ['Appliances', 'Cookware', 'Furniture', 'Decor'],
    products: ['Personal Blender Pro', 'Non-Stick Cookware Set', 'LED Desk Lamp', 'HEPA Air Purifier', 'Drip Coffee Maker', 'Stainless Steel Kettle', 'Microfiber Bed Sheets', 'Memory Foam Pillow', 'Robot Vacuum Cleaner', 'Wall Mount Spice Rack', 'Ceramic Dinnerware Set', 'Silicon Spatula Set', 'Digital Food Scale', 'Insulated Travel Mug', 'Aroma Essential Oil Diffuser', 'Velvet Throw Pillow', 'Wooden Dining Chair', 'Desk Organizer Shelf', 'Blackout Window Curtains', 'Standing Desk Converter']
  },
  'Sports': {
    subcategories: ['Fitness', 'Outdoors', 'Team Sports', 'Footwear'],
    products: ['Premium Yoga Mat', 'Adjustable Dumbbell Set', 'Leather Soccer Ball', 'Trail Running Shoes', 'Hydration Backpack', 'Resistance Band Set', 'Waterproof Camping Tent', 'Sleeping Bag Compact', 'Tennis Racket Graphite', 'Swimming Goggles Anti-Fog', 'Cycling Helmet Pro', 'Folding Camp Chair', 'Basketball Official Size', 'Golf Balls 12-Pack', 'Trekking Poles Carbon', 'Workout Jump Rope', 'Sports Duffel Bag', 'Foam Roller Massager', 'Agility Speed Ladder', 'Microfiber Gym Towel']
  },
  'Beauty': {
    subcategories: ['Skincare', 'Makeup', 'Haircare', 'Fragrance'],
    products: ['Hydrating Serum Hyaluronic', 'Matte Liquid Lipstick', 'Oatmeal Facial Moisturizer', 'Sulfate-Free Shampoo', 'Broad Spectrum Sunscreen', 'Argan Hair Oil Mist', 'Eyeliner Gel Jet Black', 'Mascara Volume Lift', 'Clay Cleansing Mask', 'Exfoliating Face Scrub', 'Eud de Parfum Spray', 'Moisturizing Lip Balm', 'Nail Polish Set Pastel', 'Rosewater Face Toner', 'Detangling Hair Brush', 'Anti-Aging Night Cream', 'Vitamin C Brightening Serum', 'Makeup Brush Set 12pc', 'Hydrating Eye Cream', 'Charcoal Peel-off Mask']
  },
  'Books': {
    subcategories: ['Fiction', 'Non-Fiction', 'Educational', 'Sci-Fi'],
    products: ['Chronicles of Yesterday', 'The Echo of Silence', 'AI and Future Societies', 'Python Coding Handbook', 'Mindset for Success', 'History of Modern Trade', 'Into the Cosmos: Sci-Fi', 'Culinary Masterclass Cookbook', 'Unlocking the Human Brain', 'Biomimicry in Action', 'Introduction to SQL Queries', 'The Lost City Adventure', 'Data Science from Scratch', 'The Psychology of Money Habit', 'Leadership Strategies for Growth', 'A Brief Guide to Astrophysics', 'Mystery of the Clockwork Key', 'Creative Writing Masterclass', 'Economics in One Lesson', 'The Poetry of Natural Forms']
  }
};

// Seeding Engine
async function seedDatabase() {
  console.log('Starting data generation...');
  const currentDbType = process.env.DB_TYPE || 'postgres';

  // Helper to get random item
  const randomItem = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const randomRange = (min, max) => Math.random() * (max - min) + min;
  const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  // Helper to generate a date between start and end
  function randomDate(start, end) {
    return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
  }

  // 1. Seed Products (2,000 products)
  console.log('Generating 2,000 products...');
  const products = [];
  const categories = Object.keys(categoryData);
  
  for (let i = 1; i <= 2000; i++) {
    const category = randomItem(categories);
    const catDetails = categoryData[category];
    const subcategory = randomItem(catDetails.subcategories);
    const prodBaseName = randomItem(catDetails.products);
    const product_name = `${prodBaseName} #${i}`;
    
    // Determine cost price and selling price based on category
    let cost_price = 0;
    let selling_price = 0;
    
    if (category === 'Electronics') {
      cost_price = parseFloat(randomRange(40, 750).toFixed(2));
      selling_price = parseFloat((cost_price * randomRange(1.15, 1.45)).toFixed(2));
    } else if (category === 'Fashion') {
      cost_price = parseFloat(randomRange(8, 70).toFixed(2));
      selling_price = parseFloat((cost_price * randomRange(1.8, 3.2)).toFixed(2));
    } else if (category === 'Home & Kitchen') {
      cost_price = parseFloat(randomRange(15, 180).toFixed(2));
      selling_price = parseFloat((cost_price * randomRange(1.4, 2.0)).toFixed(2));
    } else if (category === 'Sports') {
      cost_price = parseFloat(randomRange(5, 220).toFixed(2));
      selling_price = parseFloat((cost_price * randomRange(1.3, 1.8)).toFixed(2));
    } else if (category === 'Beauty') {
      cost_price = parseFloat(randomRange(4, 55).toFixed(2));
      selling_price = parseFloat((cost_price * randomRange(2.0, 3.5)).toFixed(2));
    } else { // Books
      cost_price = parseFloat(randomRange(3, 28).toFixed(2));
      selling_price = parseFloat((cost_price * randomRange(1.4, 1.9)).toFixed(2));
    }

    products.push([i, product_name, category, subcategory, cost_price, selling_price]);
  }

  // Seeding Products in Batches
  const productBatchSize = 500;
  for (let i = 0; i < products.length; i += productBatchSize) {
    const batch = products.slice(i, i + productBatchSize);
    let insertQuery = '';
    const params = [];
    
    if (currentDbType === 'postgres') {
      insertQuery = 'INSERT INTO products (product_id, product_name, category, subcategory, cost_price, selling_price) VALUES ';
      const placeholders = batch.map((p, idx) => {
        const base = idx * 6;
        params.push(p[0], p[1], p[2], p[3], p[4], p[5]);
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
      }).join(', ');
      await query(insertQuery + placeholders, params);
    } else {
      insertQuery = 'INSERT INTO products (product_id, product_name, category, subcategory, cost_price, selling_price) VALUES ';
      const placeholders = batch.map((p, idx) => {
        params.push(p[0], p[1], p[2], p[3], p[4], p[5]);
        return `(?, ?, ?, ?, ?, ?)`;
      }).join(', ');
      await query(insertQuery + placeholders, params);
    }
  }
  console.log('Product seeding completed.');

  // 2. Seed Customers (10,000 customers)
  console.log('Generating 10,000 customers...');
  const customers = [];
  const startSignupDate = new Date(2021, 0, 1);
  const endSignupDate = new Date(2025, 11, 31);

  for (let i = 1; i <= 10000; i++) {
    const first_name = randomItem(firstNames);
    const last_name = randomItem(lastNames);
    const email = `${first_name.toLowerCase()}.${last_name.toLowerCase()}.${i}@${randomItem(domains)}`;
    const gender = randomItem(genders);
    const region = randomItem(regionalData);
    const state = region.state;
    const country = region.country;
    const city = randomItem(region.cities);
    const signup_date = randomDate(startSignupDate, endSignupDate).toISOString().split('T')[0];

    customers.push([i, first_name, last_name, email, gender, city, state, country, signup_date]);
  }

  // Seeding Customers in Batches
  const customerBatchSize = 500;
  for (let i = 0; i < customers.length; i += customerBatchSize) {
    const batch = customers.slice(i, i + customerBatchSize);
    let insertQuery = '';
    const params = [];
    
    if (currentDbType === 'postgres') {
      insertQuery = 'INSERT INTO customers (customer_id, first_name, last_name, email, gender, city, state, country, signup_date) VALUES ';
      const placeholders = batch.map((c, idx) => {
        const base = idx * 9;
        params.push(c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8]);
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`;
      }).join(', ');
      await query(insertQuery + placeholders, params);
    } else {
      insertQuery = 'INSERT INTO customers (customer_id, first_name, last_name, email, gender, city, state, country, signup_date) VALUES ';
      const placeholders = batch.map((c, idx) => {
        params.push(c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8]);
        return `(?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      }).join(', ');
      await query(insertQuery + placeholders, params);
    }
  }
  console.log('Customer seeding completed.');

  // 3. Seed Orders and Order Items (100,000 orders, ~2.2 items per order = ~220,000 items)
  console.log('Generating 100,000 orders and order items...');
  const orderStatuses = ['Delivered', 'Cancelled', 'Returned', 'Processing'];
  const startOrderDate = new Date(2022, 0, 1);
  const endOrderDate = new Date(2026, 4, 31); // 2026-05-31

  let itemCounter = 1;
  const ordersBatchSize = 1000;
  
  // We'll write to a database in chunks of 1000 orders to avoid huge memory payloads
  for (let chunkIdx = 0; chunkIdx < 100000; chunkIdx += ordersBatchSize) {
    const ordersBatch = [];
    const orderItemsBatch = [];
    
    for (let i = 1; i <= ordersBatchSize; i++) {
      const orderId = chunkIdx + i;
      const customerId = randomInt(1, 10000);
      
      // Order status probabilities: Delivered (82%), Cancelled (8%), Returned (6%), Processing (4%)
      const randStatus = Math.random();
      let order_status = 'Delivered';
      if (randStatus < 0.08) order_status = 'Cancelled';
      else if (randStatus < 0.14) order_status = 'Returned';
      else if (randStatus < 0.18) order_status = 'Processing';

      // Pick date matching customer signup date constraint (order must be after customer signup)
      // For simplicity, generate random date in 2022-2026 range. If it is before customer's signup date, we can shift it,
      // or we can just draw a date and ensure signup date was before it. Let's make sure order date is realistic.
      // If we draw a random date, most will be after signup.
      const order_date = randomDate(startOrderDate, endOrderDate).toISOString().split('T')[0];
      ordersBatch.push([orderId, customerId, order_date, order_status]);
      
      // Determine number of items in this order (1 to 5, heavily skewed to 1 or 2)
      const randItemsCount = Math.random();
      let itemsCount = 1;
      if (randItemsCount > 0.92) itemsCount = 4;
      else if (randItemsCount > 0.80) itemsCount = 3;
      else if (randItemsCount > 0.45) itemsCount = 2;

      // Select unique products for this order
      const orderProductIds = new Set();
      while (orderProductIds.size < itemsCount) {
        orderProductIds.add(randomInt(1, 2000));
      }

      for (const prodId of orderProductIds) {
        const quantity = randomInt(1, 4);
        // Look up product price (simulate price matching selling_price of the product)
        const product = products[prodId - 1];
        const unit_price = product[5]; // selling price index

        orderItemsBatch.push([itemCounter++, orderId, prodId, quantity, unit_price]);
      }
    }

    // Write Orders Batch
    let ordersInsert = '';
    const ordersParams = [];
    if (currentDbType === 'postgres') {
      ordersInsert = 'INSERT INTO orders (order_id, customer_id, order_date, order_status) VALUES ';
      const placeholders = ordersBatch.map((o, idx) => {
        const base = idx * 4;
        ordersParams.push(o[0], o[1], o[2], o[3]);
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
      }).join(', ');
      await query(ordersInsert + placeholders, ordersParams);
    } else {
      ordersInsert = 'INSERT INTO orders (order_id, customer_id, order_date, order_status) VALUES ';
      const placeholders = ordersBatch.map((o) => {
        ordersParams.push(o[0], o[1], o[2], o[3]);
        return `(?, ?, ?, ?)`;
      }).join(', ');
      await query(ordersInsert + placeholders, ordersParams);
    }

    // Write Order Items Batch in smaller chunks of 1000 items due to larger array sizes
    const itemsChunkSize = 1000;
    for (let j = 0; j < orderItemsBatch.length; j += itemsChunkSize) {
      const itemsBatch = orderItemsBatch.slice(j, j + itemsChunkSize);
      let itemsInsert = '';
      const itemsParams = [];
      
      if (currentDbType === 'postgres') {
        itemsInsert = 'INSERT INTO order_items (item_id, order_id, product_id, quantity, unit_price) VALUES ';
        const placeholders = itemsBatch.map((item, idx) => {
          const base = idx * 5;
          itemsParams.push(item[0], item[1], item[2], item[3], item[4]);
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
        }).join(', ');
        await query(itemsInsert + placeholders, itemsParams);
      } else {
        itemsInsert = 'INSERT INTO order_items (item_id, order_id, product_id, quantity, unit_price) VALUES ';
        const placeholders = itemsBatch.map((item) => {
          itemsParams.push(item[0], item[1], item[2], item[3], item[4]);
          return `(?, ?, ?, ?, ?)`;
        }).join(', ');
        await query(itemsInsert + placeholders, itemsParams);
      }
    }

    if ((chunkIdx + ordersBatchSize) % 20000 === 0) {
      console.log(`Generated and saved ${chunkIdx + ordersBatchSize} orders and items...`);
    }
  }

  // Adjust Customer Signup Dates to be BEFORE their earliest order
  // For standard analytical queries to be clean, let's fix any signup date that is after order date
  console.log('Aligning customer signup dates with order dates...');
  if (currentDbType === 'postgres') {
    await query(`
      UPDATE customers c
      SET signup_date = o.first_order - INTERVAL '1 day'
      FROM (
        SELECT customer_id, MIN(order_date) as first_order
        FROM orders
        GROUP BY customer_id
      ) o
      WHERE c.customer_id = o.customer_id AND c.signup_date > o.first_order
    `);
  } else {
    // SQLite syntax update
    await query(`
      UPDATE customers
      SET signup_date = DATE((
        SELECT MIN(order_date) 
        FROM orders 
        WHERE orders.customer_id = customers.customer_id
      ), '-1 day')
      WHERE EXISTS (
        SELECT 1 
        FROM orders 
        WHERE orders.customer_id = customers.customer_id 
          AND customers.signup_date > orders.order_date
      )
    `);
  }

  console.log('Seeding database complete. Seeding was successful.');
}

// Execute setup and seed if run via command line
if (require.main === module) {
  (async () => {
    try {
      initDb();
      await checkConnection();
      await setupSchema();
      await seedDatabase();
      console.log('Database initialization run successful. Exiting.');
      if (pgPool) await pgPool.end();
      if (sqliteDb) sqliteDb.close();
      process.exit(0);
    } catch (err) {
      console.error('Database initialization failed:', err);
      process.exit(1);
    }
  })();
}

module.exports = {
  initDb,
  checkConnection,
  query,
  seedDatabase,
  setupSchema
};
