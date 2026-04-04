export type WeatherTipsRequestBody = {
  location: string;
  today: {
    condition: string;
    tempNow: number;
    high: number;
    low: number;
    humidity: number;
    windText: string;
  };
  tomorrow: {
    dateLabel: string;
    condition: string;
    high: number;
    low: number;
  };
};
