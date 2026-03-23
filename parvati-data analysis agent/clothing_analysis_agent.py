import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from datetime import datetime
import os

class ClothingDataAnalysisAgent:
    def __init__(self, data_path=None):
        self.data = None
        self.data_path = data_path
        plt.style.use('seaborn-v0_8')

    def load_data(self, file_path=None):
        """Load data from Excel/CSV file"""
        if file_path is None:
            file_path = self.data_path

        if file_path.endswith('.xlsx') or file_path.endswith('.xls'):
            self.data = pd.read_excel(file_path)
        elif file_path.endswith('.csv'):
            self.data = pd.read_csv(file_path)
        else:
            raise ValueError("Unsupported file format. Use .xlsx, .xls, or .csv")

        print(f"Data loaded successfully. Shape: {self.data.shape}")
        print(f"Columns: {list(self.data.columns)}")
        print("First 5 rows:")
        print(self.data.head())
        return self.data

    def clean_data(self):
        """Basic data cleaning"""
        if self.data is None:
            raise ValueError("No data loaded. Call load_data() first.")

        # Remove rows where the first column is NaN or contains header text
        self.data = self.data.dropna(subset=[self.data.columns[0]])
        self.data = self.data[~self.data[self.data.columns[0]].astype(str).str.contains('Date|Laxmi', na=False)]

        # Convert date column if it exists
        date_col = self.data.columns[0]
        try:
            self.data[date_col] = pd.to_datetime(self.data[date_col], errors='coerce')
        except:
            pass

        # Remove any remaining rows with NaN dates
        self.data = self.data.dropna(subset=[date_col])

        print("Data cleaned successfully.")
        print(f"Remaining data shape: {self.data.shape}")
        return self.data

    def analyze_monthly_trends(self):
        """Analyze monthly purchase trends"""
        if self.data is None:
            raise ValueError("No data loaded. Call load_data() first.")

        # For this specific data structure, assume:
        # Column 0: Date
        # Column 1: Item/Order identifier
        date_col = self.data.columns[0]  # 'Unnamed: 0'
        item_col = self.data.columns[1]  # 'PARTVATI ETHNIC WEAR'

        if date_col and item_col:
            # Convert date column and create month column
            try:
                self.data['parsed_date'] = pd.to_datetime(self.data[date_col], errors='coerce')
                self.data['month'] = self.data['parsed_date'].dt.to_period('M')

                # Filter out rows without valid dates
                valid_data = self.data.dropna(subset=['parsed_date'])

                # Group by month and item
                monthly_trends = valid_data.groupby(['month', item_col]).size().unstack().fillna(0)

                print("Monthly Trends Analysis:")
                print(monthly_trends.tail())

                return monthly_trends
            except Exception as e:
                print(f"Error processing dates: {e}")
                return None
        else:
            print("Could not identify date and item columns.")
            return None

    def generate_insights(self):
        """Generate business insights"""
        if self.data is None:
            raise ValueError("No data loaded. Call load_data() first.")

        insights = {}

        # Most popular items (using column 1 as item identifier)
        item_col = self.data.columns[1]  # 'PARTVATI ETHNIC WEAR'
        if item_col:
            # Filter out non-numeric entries that might be headers
            valid_items = self.data[item_col].dropna()
            valid_items = valid_items[valid_items != 'Laxmi Lifestyle']  # Remove header
            try:
                # Convert to string and count
                item_counts = valid_items.astype(str).value_counts().head(5)
                insights['top_items'] = item_counts.to_dict()
            except:
                insights['top_items'] = {}

        # Monthly revenue if there's a price column (look for AUD or amount columns)
        amount_cols = []
        for col in self.data.columns:
            if 'AUD' in str(col).upper() or 'amount' in str(col).lower() or 'price' in str(col).lower():
                amount_cols.append(col)

        if amount_cols and 'parsed_date' in self.data.columns:
            amount_col = amount_cols[0]
            try:
                valid_data = self.data.dropna(subset=['parsed_date', amount_col])
                monthly_revenue = valid_data.groupby('month')[amount_col].sum()
                insights['monthly_revenue'] = monthly_revenue.to_dict()
            except:
                pass

        return insights

    def create_visualizations(self, save_path='visualizations/'):
        """Create and save visualizations"""
        if self.data is None:
            raise ValueError("No data loaded. Call load_data() first.")

        os.makedirs(save_path, exist_ok=True)

        # Monthly trends chart
        try:
            monthly_data = self.analyze_monthly_trends()
            if monthly_data is not None:
                monthly_data.plot(kind='line', figsize=(12, 6))
                plt.title('Monthly Clothing Item Purchases')
                plt.xlabel('Month')
                plt.ylabel('Number of Purchases')
                plt.legend(bbox_to_anchor=(1.05, 1), loc='upper left')
                plt.tight_layout()
                plt.savefig(f'{save_path}monthly_trends.png', dpi=300, bbox_inches='tight')
                plt.close()
                print(f"Monthly trends chart saved to {save_path}monthly_trends.png")
        except Exception as e:
            print(f"Could not create monthly trends chart: {e}")

        # Item popularity chart
        try:
            item_col = self.data.columns[1]  # 'PARTVATI ETHNIC WEAR'
            if 'parsed_date' in self.data.columns:
                # Filter valid data
                valid_data = self.data.dropna(subset=['parsed_date'])
                valid_items = valid_data[item_col].dropna()
                valid_items = valid_items[valid_items != 'Laxmi Lifestyle']  # Remove header

                item_counts = valid_items.astype(str).value_counts().head(10)

                plt.figure(figsize=(10, 6))
                item_counts.plot(kind='bar')
                plt.title('Top 10 Most Popular Items')
                plt.xlabel('Item ID')
                plt.ylabel('Number of Transactions')
                plt.xticks(rotation=45, ha='right')
                plt.tight_layout()
                plt.savefig(f'{save_path}item_popularity.png', dpi=300, bbox_inches='tight')
                plt.close()
                print(f"Item popularity chart saved to {save_path}item_popularity.png")
        except Exception as e:
            print(f"Could not create item popularity chart: {e}")

def main():
    """Main function to run the analysis"""
    agent = ClothingDataAnalysisAgent()

    # Example usage - replace with your actual file path
    # agent.load_data('your_spreadsheet.xlsx')
    # agent.clean_data()
    # agent.analyze_monthly_trends()
    # insights = agent.generate_insights()
    # agent.create_visualizations()

    print("Clothing Data Analysis Agent initialized.")
    print("To use:")
    print("1. Create an instance: agent = ClothingDataAnalysisAgent()")
    print("2. Load your data: agent.load_data('path/to/your/spreadsheet.xlsx')")
    print("3. Clean data: agent.clean_data()")
    print("4. Analyze trends: agent.analyze_monthly_trends()")
    print("5. Generate insights: insights = agent.generate_insights()")
    print("6. Create visualizations: agent.create_visualizations()")

if __name__ == "__main__":
    main()