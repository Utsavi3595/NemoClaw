#!/usr/bin/env python3
"""
Demo script for the Clothing Data Analysis Agent
"""

from clothing_analysis_agent import ClothingDataAnalysisAgent

def main():
    # Create the analysis agent
    agent = ClothingDataAnalysisAgent()

    # Load sample data
    print("Loading your data...")
    agent.load_data(r'C:\Users\utsav\OneDrive\Documents\Parvati Ethnic Wear.xlsx')

    # Clean the data
    print("\nCleaning data...")
    agent.clean_data()

    # Analyze monthly trends
    print("\nAnalyzing monthly trends...")
    monthly_trends = agent.analyze_monthly_trends()

    # Generate insights
    print("\nGenerating business insights...")
    insights = agent.generate_insights()
    print("Top selling items:")
    for item, count in insights.get('top_items', {}).items():
        print(f"  {item}: {count} purchases")

    if 'monthly_revenue' in insights:
        print("\nMonthly revenue:")
        for month, revenue in insights['monthly_revenue'].items():
            print(f"  {month}: ${revenue:.2f}")

    # Create visualizations
    print("\nCreating visualizations...")
    agent.create_visualizations()

    print("\nAnalysis complete! Check the 'visualizations' folder for charts.")

if __name__ == "__main__":
    main()