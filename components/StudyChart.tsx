'use client';

import { useEffect, useRef } from 'react';
import type { Session } from '@/lib/supabase';
import {
  Chart,
  BarElement, LineElement, PointElement,
  BarController, LineController,
  CategoryScale, LinearScale,
  Tooltip, Legend,
} from 'chart.js';

Chart.register(BarElement, LineElement, PointElement, BarController, LineController, CategoryScale, LinearScale, Tooltip, Legend);

const pad = (n: number) => String(n).padStart(2, '0');
const fmtDateISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function durationMinutes(s: Session) {
  return Math.max(0, Math.round((new Date(s.end).getTime() - new Date(s.start).getTime()) / 60000));
}

export default function StudyChart({ sessions, range, dailyTargetHrs }: {
  sessions: Session[];
  range: number;
  dailyTargetHrs: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const now = new Date();
    const data: { date: string; mins: number; label: string }[] = [];
    for (let i = range - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const iso = fmtDateISO(d);
      const mins = sessions.filter(s => s.date === iso).reduce((sum, s) => sum + durationMinutes(s), 0);
      data.push({ date: iso, mins, label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) });
    }

    const gridColor = 'rgba(255,255,255,0.06)';
    const textColor = '#9AA79C';

    if (chartRef.current) chartRef.current.destroy();

    chartRef.current = new Chart(canvasRef.current, {
      data: {
        labels: data.map(d => d.label),
        datasets: [
          {
            type: 'bar',
            label: 'Hours studied',
            data: data.map(d => +(d.mins / 60).toFixed(2)),
            backgroundColor: data.map(d =>
              (d.mins / 60) >= dailyTargetHrs && dailyTargetHrs > 0 ? '#7FA98C' : '#E8B23E'
            ),
            borderRadius: 3,
            maxBarThickness: 22,
          },
          {
            type: 'line',
            label: 'Daily target',
            data: data.map(() => dailyTargetHrs || null),
            borderColor: '#D9614C',
            borderDash: [4, 4],
            borderWidth: 1.5,
            pointRadius: 0,
            fill: false,
          } as any,
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            ticks: { color: textColor, font: { family: 'JetBrains Mono', size: 11 }, maxRotation: 45, autoSkip: range > 30 },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            ticks: { color: textColor, font: { family: 'JetBrains Mono', size: 11 }, callback: (v: any) => v + 'h' },
            grid: { color: gridColor },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx: any) =>
                ctx.dataset.label === 'Daily target' && !ctx.raw ? null : `${ctx.dataset.label}: ${ctx.formattedValue}h`,
            },
          },
        },
      },
    } as any);

    // Capture ref at creation time so cleanup only destroys this instance
    const chart = chartRef.current;
    return () => { chart?.destroy(); };
  }, [sessions, range, dailyTargetHrs]);

  // Heat strip
  const now = new Date();
  const heatData: { mins: number; label: string; level: number }[] = [];
  for (let i = Math.min(range, 90) - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const iso = fmtDateISO(d);
    const mins = sessions.filter(s => s.date === iso).reduce((sum, s) => sum + durationMinutes(s), 0);
    const ratio = dailyTargetHrs > 0 ? (mins / 60) / dailyTargetHrs : (mins > 0 ? 1 : 0);
    let level = 0;
    if (mins > 0) level = ratio >= 1 ? 4 : ratio >= 0.66 ? 3 : ratio >= 0.33 ? 2 : 1;
    heatData.push({ mins, label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), level });
  }

  return (
    <>
      <div style={{ position: 'relative', height: 260 }}>
        <canvas ref={canvasRef} />
      </div>
      <div className="heat-strip">
        {heatData.map((d, i) => (
          <div key={i} className="heat-cell" data-level={d.level} title={`${d.label}: ${Math.floor(d.mins / 60)}h ${d.mins % 60}m`} />
        ))}
      </div>
    </>
  );
}
