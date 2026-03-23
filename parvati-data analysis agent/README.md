# Clothing Data Analysis Agent

A Python-based data analysis agent designed to help clothing business owners analyze monthly purchase data from spreadsheets and gain insights for business planning.

## Features

- **Data Loading**: Supports Excel (.xlsx/.xls) and CSV files
- **Data Cleaning**: Automatic data preprocessing and cleaning
- **Trend Analysis**: Monthly purchase trend analysis
- **Business Insights**: Generate actionable business insights
- **Visualizations**: Create charts and graphs for data visualization

## Installation

1. Clone or download this repository
2. Install required dependencies:
   ```bash
   pip install -r requirements.txt
   ```

## Usage

1. Prepare your spreadsheet with columns for:
   - Date/Month of purchase
   - Customer information (optional)
   - Clothing item/product name
   - Price/cost (optional)
   - Quantity (optional)

2. Run the analysis:
   ```python
   from clothing_analysis_agent import ClothingDataAnalysisAgent

   # Create agent instance
   agent = ClothingDataAnalysisAgent()

   # Load your data (replace with your actual file path)
   agent.load_data(r'C:\Users\utsav\OneDrive\Documents\Parvati Ethnic Wear.xlsx')

   # Clean and analyze
   agent.clean_data()
   agent.analyze_monthly_trends()

   # Generate insights and visualizations
   insights = agent.generate_insights()
   agent.create_visualizations()
   ```

Or simply run the demo script:
```bash
python demo.py
```

## Sample Data Format

Your spreadsheet should have columns similar to:
- `Date` or `Month`: Purchase date
- `Item` or `Product`: Clothing item name
- `Customer`: Customer identifier (optional)
- `Price`: Item price (optional)
- `Quantity`: Number of items purchased (optional)

## Output

The agent will generate:
- Monthly trend analysis showing purchase patterns
- Top-selling items
- Revenue trends (if price data available)
- Visual charts saved in the `visualizations/` folder

## Requirements

- Python 3.7+
- pandas
- numpy
- matplotlib
- seaborn
- openpyxl (for Excel files)

## Contributing

Feel free to contribute improvements or additional analysis features!