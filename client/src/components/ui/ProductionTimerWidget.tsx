import { useState } from 'react';
import { useProductionTimers, type ProductionTimer } from '../../context/ProductionTimerContext';
import { Clock, X, ChevronUp, ChevronDown } from 'lucide-react';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function ProductionTimerWidget() {
  const { timers, stopTimer, getTimerRemaining } = useProductionTimers();
  const [expanded, setExpanded] = useState(false);

  if (timers.length === 0) return null;

  // Find the timer closest to finishing
  const sortedTimers = [...timers].sort((a, b) => a.endsAt - b.endsAt);
  const nextTimer = sortedTimers[0];
  const nextRemaining = getTimerRemaining(nextTimer.id);

  return (
    <div className="fixed bottom-4 right-4 z-[45] max-w-sm">
      {/* Expanded list */}
      {expanded && timers.length > 0 && (
        <div className="mb-2 bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-500 text-white flex items-center justify-between">
            <span className="text-sm font-semibold flex items-center gap-2">
              <Clock size={14} /> Chronometres actifs
            </span>
            <button onClick={() => setExpanded(false)} className="p-1 hover:bg-white/20 rounded-lg transition-colors">
              <ChevronDown size={14} />
            </button>
          </div>
          <div className="divide-y divide-gray-100 max-h-64 overflow-auto">
            {sortedTimers.map((timer) => {
              const remaining = getTimerRemaining(timer.id);
              const progress = 1 - (remaining / (timer.durationMin * 60));
              const isUrgent = remaining < 60;

              return (
                <div key={timer.id} className="px-4 py-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{timer.stepName}</p>
                      <p className="text-[11px] text-gray-500 truncate">{timer.productName}</p>
                    </div>
                    <div className="flex items-center gap-2 ml-2">
                      <span className={`text-lg font-bold font-mono ${isUrgent ? 'text-red-600 animate-pulse' : 'text-blue-700'}`}>
                        {formatTime(remaining)}
                      </span>
                      <button
                        onClick={() => stopTimer(timer.id)}
                        className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        title="Arreter"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${isUrgent ? 'bg-red-500' : 'bg-blue-500'}`}
                      style={{ width: `${Math.min(100, progress * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Compact pill */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`flex items-center gap-2.5 pl-4 pr-5 py-3 rounded-2xl shadow-lg transition-all hover:shadow-xl ${
          nextRemaining < 60
            ? 'bg-gradient-to-r from-red-500 to-orange-500 text-white animate-pulse'
            : 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white'
        }`}
      >
        <Clock size={18} />
        <div className="text-left">
          <span className="text-lg font-bold font-mono">{formatTime(nextRemaining)}</span>
          <span className="block text-[10px] opacity-80 truncate max-w-[140px]">
            {nextTimer.stepName}
          </span>
        </div>
        {timers.length > 1 && (
          <span className="ml-1 w-5 h-5 rounded-full bg-white/30 flex items-center justify-center text-[10px] font-bold">
            {timers.length}
          </span>
        )}
        {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </button>
    </div>
  );
}
