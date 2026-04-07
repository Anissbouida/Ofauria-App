import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Check, CheckCheck, Package, ChefHat, Clock, X } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationsApi } from '../../api/notifications.api';
import type { Notification } from '../../api/notifications.api';
import { useAuth } from '../../context/AuthContext';

const POLL_INTERVAL = 30_000; // 30 seconds

const NOTIFICATION_ICONS: Record<string, typeof Bell> = {
  production_plan_created: ChefHat,
  production_plan_confirmed: ChefHat,
  production_completed: Check,
  order_created: Package,
  order_confirmed: Package,
  order_ready: Package,
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "A l'instant";
  if (minutes < 60) return `Il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Hier';
  return `Il y a ${days} jours`;
}

export default function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Poll unread count
  const { data: unreadCount = 0 } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: notificationsApi.unreadCount,
    refetchInterval: POLL_INTERVAL,
    enabled: !!user,
  });

  // Fetch notifications on demand
  const { data: notificationsData, refetch: refetchList } = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => notificationsApi.list(),
    enabled: false, // only on demand
  });

  const notifications: Notification[] = notificationsData?.data || [];

  // Mark single as read
  const markReadMutation = useMutation({
    mutationFn: notificationsApi.markAsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  // Mark all as read
  const markAllReadMutation = useMutation({
    mutationFn: notificationsApi.markAllAsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const handleOpen = useCallback(() => {
    setOpen(prev => {
      if (!prev) refetchList();
      return !prev;
    });
  }, [refetchList]);

  const handleClickNotification = (notif: Notification) => {
    // Mark as read
    if (!notif.read_by.includes(user?.id || '')) {
      markReadMutation.mutate(notif.id);
    }

    // Navigate to the relevant page
    if (notif.reference_type === 'production_plan' && notif.reference_id) {
      navigate(`/production/${notif.reference_id}`);
    } else if (notif.reference_type === 'replenishment_request' && notif.reference_id) {
      navigate(`/replenishment/${notif.reference_id}`);
    } else if (notif.reference_type === 'order' && notif.reference_id) {
      navigate('/orders');
    }

    setOpen(false);
  };

  const isRead = (notif: Notification) => notif.read_by.includes(user?.id || '');

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell button */}
      <button
        onClick={handleOpen}
        className="relative p-1.5 rounded hover:bg-white/15 transition-colors"
        title="Notifications"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1 leading-none animate-pulse">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 sm:w-96 bg-white rounded-xl shadow-2xl border border-gray-200 text-gray-800 z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
            <h3 className="font-semibold text-sm">Notifications</h3>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={() => markAllReadMutation.mutate()}
                  className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 font-medium"
                  title="Tout marquer comme lu"
                >
                  <CheckCheck size={14} />
                  Tout lire
                </button>
              )}
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Notification list */}
          <div className="max-h-[400px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                <Bell size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">Aucune notification</p>
              </div>
            ) : (
              notifications.map(notif => {
                const Icon = NOTIFICATION_ICONS[notif.type] || Bell;
                const read = isRead(notif);

                return (
                  <button
                    key={notif.id}
                    onClick={() => handleClickNotification(notif)}
                    className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0 flex gap-3 ${
                      read ? 'opacity-60' : ''
                    }`}
                  >
                    {/* Icon */}
                    <div className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center mt-0.5 ${
                      read ? 'bg-gray-100 text-gray-400' : 'bg-blue-100 text-blue-600'
                    }`}>
                      <Icon size={16} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-sm leading-tight ${read ? 'font-normal' : 'font-semibold'}`}>
                          {notif.title}
                        </p>
                        {!read && (
                          <span className="shrink-0 w-2 h-2 rounded-full bg-blue-500 mt-1.5" />
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5 leading-snug line-clamp-2">
                        {notif.message}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <Clock size={10} className="text-gray-300" />
                        <span className="text-[10px] text-gray-400">{timeAgo(notif.created_at)}</span>
                        {notif.creator_first_name && (
                          <span className="text-[10px] text-gray-400">
                            — {notif.creator_first_name} {notif.creator_last_name?.[0]}.
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
