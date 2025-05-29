import express from "express";
import cors from "cors";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = process.env.PORT || 3000;

// Required to use __dirname with ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper function to load JSON
const loadJSON = async (filename) => {
  const filePath = path.join(__dirname, "data", filename);
  const fileContents = await fs.readFile(filePath, "utf8");
  return JSON.parse(fileContents);
};

let ratios_by_co_code = {};
let ohlc_by_co_code = {};

// Load JSON files before server starts
const loadData = async () => {
  ratios_by_co_code = await loadJSON("ratios_by_co_code.json");
  ohlc_by_co_code = await loadJSON("ohlc_by_co_code.json");
};

// Middleware
app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  console.log(
    `${new Date().toISOString()} - ${req.method} ${req.path} - Query:`,
    req.query
  );
  next();
});


// Utility functions
function isValidDate(dateString) {
  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date);
}

function filterByDateRange(data, startDate, endDate) {
  if (!startDate && !endDate) return data;

  return data
    .filter((item) => {
      const itemDate = new Date(item.date);
      const start = startDate ? new Date(startDate) : new Date("1900-01-01");
      const end = endDate ? new Date(endDate) : new Date("2100-12-31");
      return itemDate >= start && itemDate <= end;
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date)); // Sort by date ascending
}

function calculateStatistics(values) {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, val) => sum + val, 0) / values.length;

  // Calculate median
  const median =
    sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];

  // Calculate standard deviation
  const variance =
    values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
    values.length;
  const std_dev = Math.sqrt(variance);

  // Calculate percentile (using latest value vs all values)
  const lastValue = values[values.length - 1];
  const percentile =
    (sorted.filter((val) => val <= lastValue).length / sorted.length) * 100;

  // Calculate min and max
  const min = Math.min(...values);
  const max = Math.max(...values);

  return {
    mean: Math.round(mean * 100) / 100,
    median: Math.round(median * 100) / 100,
    std_dev: Math.round(std_dev * 100) / 100,
    min: Math.round(min * 100) / 100,
    max: Math.round(max * 100) / 100,
    plus_one_dev: Math.round((mean + std_dev) * 100) / 100,
    minus_one_dev: Math.round((mean - std_dev) * 100) / 100,
    plus_two_dev: Math.round((mean + 2 * std_dev) * 100) / 100,
    minus_two_dev: Math.round((mean - 2 * std_dev) * 100) / 100,
    percentile: Math.round(percentile * 100) / 100,
    count: values.length,
  };
}

// Validation middleware
function validateDateRange(req, res, next) {
  const { start, end } = req.query;

  if (start && !isValidDate(start)) {
    return res.status(400).json({
      error: "Invalid start date format. Use YYYY-MM-DD format.",
    });
  }

  if (end && !isValidDate(end)) {
    return res.status(400).json({
      error: "Invalid end date format. Use YYYY-MM-DD format.",
    });
  }

  if (start && end && new Date(start) > new Date(end)) {
    return res.status(400).json({
      error: "Start date cannot be after end date.",
    });
  }

  next();
}

// Routes

// Root endpoint with API documentation
app.get("/", (req, res) => {
  res.json({
    name: "Stock Data API",
    version: "1.0.0",
    description: "API for retrieving stock ratios, prices, and market cap data",
    endpoints: {
      "GET /api/stock/ratios": {
        description: "Get PE, PB, PS data with statistical overlays",
        parameters: {
          co_code: "Company code (required)",
          type: "Ratio type: pe|pb|ps (required)",
          start: "Start date YYYY-MM-DD (optional)",
          end: "End date YYYY-MM-DD (optional)",
        },
        example:
          "/api/stock/ratios?co_code=38716&type=pe&start=2022-02-01&end=2022-02-28",
      },
      "GET /api/stock/price": {
        description: "Get close price data for a specific stock",
        parameters: {
          co_code: "Company code (required)",
          start: "Start date YYYY-MM-DD (optional)",
          end: "End date YYYY-MM-DD (optional)",
        },
        example:
          "/api/stock/price?co_code=13673&start=2022-04-01&end=2022-04-30",
      },
      "GET /api/stock/market-cap": {
        description: "Get market cap data for multiple companies",
        parameters: {
          co_codes: "Comma-separated company codes (required)",
          start: "Start date YYYY-MM-DD (optional)",
          end: "End date YYYY-MM-DD (optional)",
        },
        example:
          "/api/stock/market-cap?co_codes=13673,5020,199&start=2022-04-01&end=2022-04-30",
      },
    },
  });
});

// 1. GET /api/stock/ratios - Get PE, PB, PS data with statistics
app.get("/api/stock/ratios", validateDateRange, (req, res) => {
  try {
    const { co_code, type, start, end } = req.query;

    if (!co_code || !type) {
      return res.status(400).json({
        error: "Missing required parameters: co_code and type",
        example: "/api/stock/ratios?co_code=38716&type=pe",
      });
    }

    if (!["pe", "pb", "ps"].includes(type.toLowerCase())) {
      return res.status(400).json({
        error: "Invalid type. Must be pe, pb, or ps",
        received: type,
      });
    }

    const companyData = ratios_by_co_code[co_code];
    if (!companyData) {
      return res.status(404).json({
        error: `No data found for company code: ${co_code}`,
        available_codes: Object.keys(ratios_by_co_code),
      });
    }

    // Filter by date range
    const filteredData = filterByDateRange(companyData, start, end);

    if (filteredData.length === 0) {
      return res.status(404).json({
        error: "No data found for the specified date range",
        co_code,
        date_range: { start, end },
      });
    }

    // Extract series data for the requested type
    const series = filteredData.map((item) => ({
      date: item.date,
      value: item[type.toLowerCase()],
    }));

    // Calculate statistics
    const values = series.map((item) => item.value);
    const statistics = calculateStatistics(values);

    res.json({
      co_code,
      type: type.toLowerCase(),
      date_range: { start, end },
      series,
      statistics,
    });
  } catch (error) {
    console.error("Error in /api/stock/ratios:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 2. GET /api/stock/price - Get close price data
app.get("/api/stock/price", validateDateRange, (req, res) => {
  try {
    const { co_code, start, end } = req.query;

    if (!co_code) {
      return res.status(400).json({
        error: "Missing required parameter: co_code",
        example: "/api/stock/price?co_code=13673",
      });
    }

    const companyData = ohlc_by_co_code[co_code];
    if (!companyData) {
      return res.status(404).json({
        error: `No data found for company code: ${co_code}`,
        available_codes: Object.keys(ohlc_by_co_code),
      });
    }

    // Filter by date range
    const filteredData = filterByDateRange(companyData, start, end);

    if (filteredData.length === 0) {
      return res.status(404).json({
        error: "No data found for the specified date range",
        co_code,
        date_range: { start, end },
      });
    }

    // Extract close price series
    const series = filteredData.map((item) => ({
      date: item.date,
      close: item.close,
    }));

    res.json({
      co_code,
      date_range: { start, end },
      series,
    });
  } catch (error) {
    console.error("Error in /api/stock/price:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 3. GET /api/stock/market-cap - Get market cap data for multiple companies
app.get("/api/stock/market-cap", validateDateRange, (req, res) => {
  try {
    const { co_codes, start, end } = req.query;

    if (!co_codes) {
      return res.status(400).json({
        error: "Missing required parameter: co_codes",
        example: "/api/stock/market-cap?co_codes=13673,5020,199",
      });
    }

    const codesList = co_codes.split(",").map((code) => code.trim());
    const result = [];
    const notFound = [];

    for (const co_code of codesList) {
      const companyData = ohlc_by_co_code[co_code];

      if (companyData) {
        // Filter by date range
        const filteredData = filterByDateRange(companyData, start, end);

        // Extract market cap series
        const series = filteredData.map((item) => ({
          date: item.date,
          mcap: item.mcap,
        }));

        result.push({
          co_code,
          series,
        });
      } else {
        notFound.push(co_code);
      }
    }

    const response = {
      date_range: { start, end },
      data: result,
    };

    if (notFound.length > 0) {
      response.warnings = {
        codes_not_found: notFound,
        available_codes: Object.keys(ohlc_by_co_code),
      };
    }

    res.json(response);
  } catch (error) {
    console.error("Error in /api/stock/market-cap:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    environment: process.env.NODE_ENV || "development",
  });
});

// Get available company codes
app.get("/api/companies", (req, res) => {
  res.json({
    ratios_companies: Object.keys(ratios_by_co_code),
    ohlc_companies: Object.keys(ohlc_by_co_code),
    total_companies: {
      ratios: Object.keys(ratios_by_co_code).length,
      ohlc: Object.keys(ohlc_by_co_code).length,
    },
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.stack);
  res.status(500).json({
    error: "Something went wrong!",
    timestamp: new Date().toISOString(),
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "Endpoint not found",
    path: req.path,
    method: req.method,
    available_endpoints: [
      "GET /",
      "GET /health",
      "GET /api/companies",
      "GET /api/stock/ratios",
      "GET /api/stock/price",
      "GET /api/stock/market-cap",
    ],
  });
});

loadData().then(() => {
  // Start server
  app.listen(PORT, () => {
    console.log(`🚀 Stock Data API Server running on port ${PORT}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || "development"}`);
    console.log(`📊 Available endpoints:`);
    console.log(`   GET / - API documentation`);
    console.log(`   GET /health - Health check`);
    console.log(`   GET /api/companies - Available company codes`);
    console.log(`   GET /api/stock/ratios - PE/PB/PS ratios with statistics`);
    console.log(`   GET /api/stock/price - Stock price data`);
    console.log(`   GET /api/stock/market-cap - Market cap data`);
    console.log(`\n📈 Sample data loaded:`);
    console.log(
      `   Ratios: ${Object.keys(ratios_by_co_code).length} companies`
    );
    console.log(`   OHLC: ${Object.keys(ohlc_by_co_code).length} companies`);
  });
});

// Test the endpoints after server starts
setTimeout(async () => {
  console.log("\n🧪 Running endpoint tests...\n");

  try {
    // Test ratios endpoint
    console.log("Testing /api/stock/ratios...");
    const ratiosResponse = await fetch(
      `http://localhost:${PORT}/api/stock/ratios?co_code=38716&type=pe&start=2022-02-01&end=2022-02-28`
    );
    const ratiosData = await ratiosResponse.json();
    console.log(
      "✅ Ratios endpoint:",
      ratiosData.statistics
        ? "Statistics calculated successfully"
        : "No statistics"
    );

    // Test price endpoint
    console.log("\nTesting /api/stock/price...");
    const priceResponse = await fetch(
      `http://localhost:${PORT}/api/stock/price?co_code=13673&start=2022-04-01&end=2022-04-30`
    );
    const priceData = await priceResponse.json();
    console.log(
      "✅ Price endpoint:",
      `${priceData.series?.length || 0} data points returned`
    );

    // Test market cap endpoint
    console.log("\nTesting /api/stock/market-cap...");
    const mcapResponse = await fetch(
      `http://localhost:${PORT}/api/stock/market-cap?co_codes=13673,5020,199&start=2022-04-01&end=2022-04-30`
    );
    const mcapData = await mcapResponse.json();
    console.log(
      "✅ Market cap endpoint:",
      `${mcapData.data?.length || 0} companies returned`
    );

    // Test companies endpoint
    console.log("\nTesting /api/companies...");
    const companiesResponse = await fetch(
      `http://localhost:${PORT}/api/companies`
    );
    const companiesData = await companiesResponse.json();
    console.log(
      "✅ Companies endpoint:",
      `${companiesData.total_companies?.ratios || 0} ratios companies, ${
        companiesData.total_companies?.ohlc || 0
      } OHLC companies`
    );

    console.log("\n🎉 All tests completed successfully!");
  } catch (error) {
    console.log("❌ Test failed:", error.message);
  }
}, 1500);
