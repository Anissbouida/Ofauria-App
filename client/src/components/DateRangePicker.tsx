import { useState, useRef, useEffect } from 'react';
import {
  format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear,
  addMonths, subMonths, eachDayOfInterval, isSameDay, isSameMonth, isWithinInterval,
  getDay, subDays,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

interface DateRangePickerProps {
  dateFrom: string;
  dateTo: string;
  onChange: (from: string, to: string) => void;
}

const PRESETS = [
  { label: "Aujourd'hui", getRange: () => { const d = new Date(); return [d, d] as const; } },
  { label: 'Hier', getRange: () => { const d = subDays(new Date(), 1); return [d, d] as const; } },
  { label: 'Cette semaine', getRange: () => { const d = new Date(); return [startOfWeek(d, { weekStartsOn: 1 }), endOfWeek(d, { weekStartsOn: 1 })] as const; } },
  { label: 'Ce mois', getRange: () => { const d = new Date(); return [startOfMonth(d), endOfMonth(d)] as const; } },
  { label: "Cette annee", getRange: () => { const d = new Date(); return [startOfYear(d), endOfYear(d)] as const; } },
];

const DAY_NAMES = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

export default function DateRangePicker({ dateFrom, dateTo, onChange }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(new Date(dateFrom || Date.now()));
  const [selecting, setSelecting] = useState<Date | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const from = dateFrom ? new Date(dateFrom + 'T00:00:00') : null;
  const to = dateTo ? new Date(dateTo + 'T00:00:00') : null;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const monthStart = startOfMonth(viewMonth);
  const monthEnd = endOfMonth(viewMonth);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const handleDayClick = (day: Date) => {
    if (!selecting) {
      setSelecting(day);
    } else {
      const [start, end] = day < selecting ? [day, selecting] : [selecting, day];
      onChange(format(start, 'yyyy-MM-dd'), format(end, 'yyyy-MM-dd'));
      setSelecting(null);
      setOpen(false);
    }
  };

  const handlePreset = (getRange: () => readonly [Date, Date]) => {
    const [start, end] = getRange();
    onChange(format(start, 'yyyy-MM-dd'), format(end, 'yyyy-MM-dd'));
    setSelecting(null);
    setOpen(false);
  };

  const handleMonthSelect = () => {
    const start = startOfMonth(viewMonth);
    const end = endOfMonth(viewMonth);
    onChange(format(start, 'yyyy-MM-dd'), format(end, 'yyyy-MM-dd'));
    setSelecting(null);
    setOpen(false);
  };

  const isDayInRange = (day: Date) => {
    if (selecting) {
      return false;
    }
    if (from && to && !isSameDay(from, to)) {
      return isWithinInterval(day, { start: from, end: to });
    }
    return false;
  };

  const isDaySelected = (day: Date) => {
    if (selecting && isSameDay(day, selecting)) return true;
    if (from && isSameDay(day, from)) return true;
    if (to && isSameDay(day, to)) return true;
    return false;
  };

  // Display label
  let displayLabel = 'Selectionner une periode';
  if (from && to) {
    if (isSameDay(from, to)) {
      displayLabel = format(from, 'dd MMM yyyy', { locale: fr });
    } else if (isSameMonth(from, to)) {
      displayLabel = `${format(from, 'dd', { locale: fr })} - ${format(to, 'dd MMM yyyy', { locale: fr })}`;
    } else {
      displayLabel = `${format(from, 'dd MMM yyyy', { locale: fr })} - ${format(to, 'dd MMM yyyy', { locale: fr })}`;
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg hover:border-gray-300 transition-colors text-sm">
        <Calendar size={16} className="text-gray-400" />
        <span className="font-medium text-gray-700">{displayLabel}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 bg-white rounded-xl shadow-xl border border-gray-200 z-50 flex">
          {/* Presets */}
          <div className="w-40 border-r border-gray-100 p-2 space-y-0.5">
            {PRESETS.map((preset) => (
              <button key={preset.label} onClick={() => handlePreset(preset.getRange)}
                className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-gray-50 text-gray-700 transition-colors">
                {preset.label}
              </button>
            ))}
            <div className="border-t border-gray-100 my-2" />
            <button onClick={handleMonthSelect}
              className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-gray-50 text-gray-700 transition-colors">
              Mois entier
            </button>
          </div>

          {/* Calendar */}
          <div className="p-4 w-72">
            {/* Month navigation */}
            <div className="flex items-center justify-between mb-3">
              <button onClick={() => setViewMonth(subMonths(viewMonth, 1))} className="p-1 hover:bg-gray-100 rounded-lg">
                <ChevronLeft size={18} className="text-gray-500" />
              </button>
              <span className="text-sm font-semibold text-gray-800 capitalize">
                {format(viewMonth, 'MMMM yyyy', { locale: fr })}
              </span>
              <button onClick={() => setViewMonth(addMonths(viewMonth, 1))} className="p-1 hover:bg-gray-100 rounded-lg">
                <ChevronRight size={18} className="text-gray-500" />
              </button>
            </div>

            {/* Day headers */}
            <div className="grid grid-cols-7 mb-1">
              {DAY_NAMES.map((d) => (
                <div key={d} className="text-center text-xs font-medium text-gray-400 py-1">{d}</div>
              ))}
            </div>

            {/* Days grid */}
            <div className="grid grid-cols-7">
              {days.map((day) => {
                const isCurrentMonth = isSameMonth(day, viewMonth);
                const selected = isDaySelected(day);
                const inRange = isDayInRange(day);
                const isRangeStart = from && isSameDay(day, from) && to && !isSameDay(from, to);
                const isRangeEnd = to && isSameDay(day, to) && from && !isSameDay(from, to);

                return (
                  <button key={day.toISOString()} onClick={() => handleDayClick(day)}
                    className={`h-8 text-xs font-medium rounded-lg transition-colors relative
                      ${!isCurrentMonth ? 'text-gray-300' : 'text-gray-700'}
                      ${selected ? 'bg-primary-600 text-white' : ''}
                      ${inRange && !selected ? 'bg-primary-50 text-primary-700' : ''}
                      ${!selected && !inRange && isCurrentMonth ? 'hover:bg-gray-100' : ''}
                      ${isRangeStart ? 'rounded-r-none' : ''}
                      ${isRangeEnd ? 'rounded-l-none' : ''}
                      ${inRange && !selected ? 'rounded-none' : ''}
                    `}>
                    {format(day, 'd')}
                  </button>
                );
              })}
            </div>

            {selecting && (
              <p className="text-xs text-primary-600 text-center mt-3">Selectionnez la date de fin</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
