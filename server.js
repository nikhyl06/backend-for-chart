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


// Time frame utility functions
function getTimeFrameDate(timeFrame) {
  const now = new Date();
  const timeFrameMap = {
    "1W": () => new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
    "1M": () => new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()),
    "3M": () => new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()),
    "6M": () => new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()),
    "1Y": () => new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()),
    "2Y": () => new Date(now.getFullYear() - 2, now.getMonth(), now.getDate()),
    ALL: () => new Date("1900-01-01"),
  };

  return timeFrameMap[timeFrame?.toUpperCase()] || null;
}

function isValidTimeFrame(timeFrame) {
  const validTimeFrames = ["1W", "1M", "3M", "6M", "1Y", "2Y", "ALL"];
  return validTimeFrames.includes(timeFrame?.toUpperCase());
}

function filterByTimeFrame(data, timeFrame) {
  if (!timeFrame || timeFrame.toUpperCase() === "ALL") {
    return data.sort((a, b) => new Date(a.date) - new Date(b.date));
  }

  const getStartDate = getTimeFrameDate(timeFrame);
  if (!getStartDate) return data;

  const startDate = getStartDate();

  return data
    .filter((item) => {
      const itemDate = new Date(item.date);
      return itemDate >= startDate;
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));
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
function validateTimeFrame(req, res, next) {
  const { timeframe } = req.query;

  if (timeframe && !isValidTimeFrame(timeframe)) {
    return res.status(400).json({
      error: "Invalid timeframe. Valid options: 1W, 1M, 3M, 6M, 1Y, 2Y, ALL",
      received: timeframe,
      valid_timeframes: ["1W", "1M", "3M", "6M", "1Y", "2Y", "ALL"],
    });
  }

  next();
}

// Routes

// Root endpoint with API documentation
app.get("/", (req, res) => {
  res.json({
    name: "Stock Data API",
    version: "2.0.0",
    description:
      "API for retrieving stock ratios, prices, and market cap data with timeframe support",
    timeframes: {
      "1W": "Last 1 week",
      "1M": "Last 1 month",
      "3M": "Last 3 months",
      "6M": "Last 6 months",
      "1Y": "Last 1 year",
      "2Y": "Last 2 years",
      ALL: "All available data",
    },
    endpoints: {
      "GET /api/stock/ratios": {
        description: "Get PE, PB, PS data with statistical overlays",
        parameters: {
          co_code: "Company code (required)",
          type: "Ratio type: pe|pb|ps (required)",
          timeframe:
            "Time period: 1W|1M|3M|6M|1Y|2Y|ALL (optional, default: ALL)",
        },
        example: "/api/stock/ratios?co_code=38716&type=pe&timeframe=1Y",
      },
      "GET /api/stock/price": {
        description: "Get close price data for a specific stock",
        parameters: {
          co_code: "Company code (required)",
          timeframe:
            "Time period: 1W|1M|3M|6M|1Y|2Y|ALL (optional, default: ALL)",
        },
        example: "/api/stock/price?co_code=13673&timeframe=6M",
      },
      "GET /api/stock/market-cap": {
        description: "Get market cap data for multiple companies",
        parameters: {
          co_codes: "Comma-separated company codes (required)",
          timeframe:
            "Time period: 1W|1M|3M|6M|1Y|2Y|ALL (optional, default: ALL)",
        },
        example: "/api/stock/market-cap?co_codes=13673,5020&timeframe=3M",
      },
    },
  });
});

// 1. GET /api/stock/ratios - Get PE, PB, PS data with statistics
app.get("/api/stock/ratios", validateTimeFrame, (req, res) => {
  try {
    const { co_code, type, timeframe = "ALL" } = req.query;

    if (!co_code || !type) {
      return res.status(400).json({
        error: "Missing required parameters: co_code and type",
        example: "/api/stock/ratios?co_code=38716&type=pe&timeframe=1Y",
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

    // Filter by timeframe
    const filteredData = filterByTimeFrame(companyData, timeframe);

    if (filteredData.length === 0) {
      return res.status(404).json({
        error: "No data found for the specified timeframe",
        co_code,
        timeframe,
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
      timeframe: timeframe.toUpperCase(),
      period_info: {
        start_date: series[0]?.date,
        end_date: series[series.length - 1]?.date,
        data_points: series.length,
      },
      series,
      statistics,
    });
  } catch (error) {
    console.error("Error in /api/stock/ratios:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 2. GET /api/stock/price - Get close price data
app.get("/api/stock/price", validateTimeFrame, (req, res) => {
  try {
    const { co_code, timeframe = "ALL" } = req.query;

    if (!co_code) {
      return res.status(400).json({
        error: "Missing required parameter: co_code",
        example: "/api/stock/price?co_code=13673&timeframe=6M",
      });
    }

    const companyData = ohlc_by_co_code[co_code];
    if (!companyData) {
      return res.status(404).json({
        error: `No data found for company code: ${co_code}`,
        available_codes: Object.keys(ohlc_by_co_code),
      });
    }

    // Filter by timeframe
    const filteredData = filterByTimeFrame(companyData, timeframe);

    if (filteredData.length === 0) {
      return res.status(404).json({
        error: "No data found for the specified timeframe",
        co_code,
        timeframe,
      });
    }

    // Extract close price series
    const series = filteredData.map((item) => ({
      date: item.date,
      close: item.close,
    }));

    res.json({
      co_code,
      timeframe: timeframe.toUpperCase(),
      period_info: {
        start_date: series[0]?.date,
        end_date: series[series.length - 1]?.date,
        data_points: series.length,
      },
      series,
    });
  } catch (error) {
    console.error("Error in /api/stock/price:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 3. GET /api/stock/market-cap - Get market cap data for multiple companies
app.get("/api/stock/market-cap", validateTimeFrame, (req, res) => {
  try {
    const { co_codes, timeframe = "ALL" } = req.query;

    if (!co_codes) {
      return res.status(400).json({
        error: "Missing required parameter: co_codes",
        example: "/api/stock/market-cap?co_codes=13673,5020&timeframe=3M",
      });
    }

    const codesList = co_codes.split(",").map((code) => code.trim());
    const result = [];
    const notFound = [];

    for (const co_code of codesList) {
      const companyData = ohlc_by_co_code[co_code];

      if (companyData) {
        // Filter by timeframe
        const filteredData = filterByTimeFrame(companyData, timeframe);

        // Extract market cap series
        const series = filteredData.map((item) => ({
          date: item.date,
          mcap: item.mcap,
        }));

        result.push({
          co_code,
          period_info: {
            start_date: series[0]?.date,
            end_date: series[series.length - 1]?.date,
            data_points: series.length,
          },
          series,
        });
      } else {
        notFound.push(co_code);
      }
    }

    const response = {
      timeframe: timeframe.toUpperCase(),
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

// Get available company codes and timeframes
app.get("/api/info", (req, res) => {
  res.json({
    timeframes: {
      "1W": "Last 1 week",
      "1M": "Last 1 month",
      "3M": "Last 3 months",
      "6M": "Last 6 months",
      "1Y": "Last 1 year",
      "2Y": "Last 2 years",
      ALL: "All available data",
    },
    companies: {
      ratios_companies: Object.keys(ratios_by_co_code),
      ohlc_companies: Object.keys(ohlc_by_co_code),
      total_companies: {
        ratios: Object.keys(ratios_by_co_code).length,
        ohlc: Object.keys(ohlc_by_co_code).length,
      },
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
      "GET /api/info",
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

// Test the endpoints with timeframes
setTimeout(async () => {
  console.log("\n🧪 Testing timeframe endpoints...\n");

  try {
    // Test ratios with 1Y timeframe
    console.log("Testing /api/stock/ratios with 1Y timeframe...");
    const ratiosResponse = await fetch(
      `http://localhost:${PORT}/api/stock/ratios?co_code=38716&type=pe&timeframe=1Y`
    );
    const ratiosData = await ratiosResponse.json();
    console.log(
      "✅ Ratios (1Y):",
      `${ratiosData.series?.length || 0} data points, period: ${
        ratiosData.period_info?.start_date
      } to ${ratiosData.period_info?.end_date}`
    );

    // Test price with 6M timeframe
    console.log("\nTesting /api/stock/price with 6M timeframe...");
    const priceResponse = await fetch(
      `http://localhost:${PORT}/api/stock/price?co_code=13673&timeframe=6M`
    );
    const priceData = await priceResponse.json();
    console.log(
      "✅ Price (6M):",
      `${priceData.series?.length || 0} data points, period: ${
        priceData.period_info?.start_date
      } to ${priceData.period_info?.end_date}`
    );

    // Test market cap with 3M timeframe
    console.log("\nTesting /api/stock/market-cap with 3M timeframe...");
    const mcapResponse = await fetch(
      `http://localhost:${PORT}/api/stock/market-cap?co_codes=13673,5020&timeframe=3M`
    );
    const mcapData = await mcapResponse.json();
    console.log(
      "✅ Market cap (3M):",
      `${mcapData.data?.length || 0} companies returned`
    );

    // Test ALL timeframe
    console.log("\nTesting /api/stock/ratios with ALL timeframe...");
    const allResponse = await fetch(
      `http://localhost:${PORT}/api/stock/ratios?co_code=38716&type=pe&timeframe=ALL`
    );
    const allData = await allResponse.json();
    console.log(
      "✅ Ratios (ALL):",
      `${allData.series?.length || 0} data points, period: ${
        allData.period_info?.start_date
      } to ${allData.period_info?.end_date}`
    );

    console.log("\n🎉 All timeframe tests completed successfully!");
  } catch (error) {
    console.log("❌ Test failed:", error.message);
  }
}, 1500);

