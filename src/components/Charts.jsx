import { Bar, Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler
} from 'chart.js'

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler
)

const baseOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: false
    },
    tooltip: {
      backgroundColor: 'rgba(255, 255, 255, 0.95)',
      titleColor: '#1f2937',
      bodyColor: '#4b5563',
      borderColor: '#e5e7eb',
      borderWidth: 1,
      padding: 10,
      boxPadding: 4,
      usePointStyle: true,
      callbacks: {
        labelColor: function(context) {
          return {
            borderColor: context.dataset.borderColor,
            backgroundColor: context.dataset.backgroundColor,
            borderWidth: 2,
            borderRadius: 2,
          };
        }
      }
    }
  },
  scales: {
    x: {
      grid: {
        display: false
      },
      ticks: {
        color: '#9ca3af',
        font: {
          size: 11
        }
      }
    },
    y: {
      grid: {
        color: '#f3f4f6',
        borderDash: [4, 4]
      },
      ticks: {
        color: '#9ca3af',
        font: {
          size: 11
        }
      },
      beginAtZero: true
    }
  },
  elements: {
    bar: {
      borderRadius: 6
    },
    line: {
      borderWidth: 3
    },
    point: {
      radius: 4,
      hoverRadius: 6,
      borderWidth: 2,
      backgroundColor: '#fff'
    }
  }
}

export function DistributionBar({ items }) {
  const labels = items.map((item) => item.label)
  const data = {
    labels,
    datasets: [
      {
        label: '课程数',
        data: items.map((item) => item.count),
        backgroundColor: 'rgba(17, 199, 168, 0.8)',
        hoverBackgroundColor: '#11c7a8',
        maxBarThickness: 40
      }
    ]
  }

  return <Bar options={baseOptions} data={data} />
}

export function TrendLine({ items }) {
  const labels = items.map((item) => item.term)
  
  const options = {
    ...baseOptions,
    scales: {
      ...baseOptions.scales,
      x: {
        ...baseOptions.scales.x,
        ticks: {
          ...baseOptions.scales.x.ticks,
          callback: function(value, index, values) {
            const label = this.getLabelForValue(value);
            // 简化标签： "2023-2024 学年 第1学期" -> "23-24 (1)"
            return label.replace(/(\d{2})(\d{2})-(\d{2})(\d{2}) 学年 第(\d+)学期/, "$2-$4 ($5)");
          }
        }
      }
    },
    plugins: {
      ...baseOptions.plugins,
      tooltip: {
        ...baseOptions.plugins.tooltip,
        callbacks: {
          ...baseOptions.plugins.tooltip.callbacks,
          title: function(context) {
            return context[0].label; // Tooltip 仍然显示完整标签
          }
        }
      }
    }
  }

  const data = {
    labels,
    datasets: [
      {
        label: '平均分',
        data: items.map((item) => Number(item.avg.toFixed(2))),
        borderColor: '#11c7a8',
        backgroundColor: (context) => {
          const ctx = context.chart.ctx;
          const gradient = ctx.createLinearGradient(0, 0, 0, 300);
          gradient.addColorStop(0, 'rgba(17, 199, 168, 0.25)');
          gradient.addColorStop(1, 'rgba(17, 199, 168, 0.02)');
          return gradient;
        },
        tension: 0.4,
        fill: true,
        pointBorderColor: '#11c7a8'
      }
    ]
  }

  return <Line options={options} data={data} />
}
