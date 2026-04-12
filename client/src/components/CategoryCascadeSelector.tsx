import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { expenseCategoriesApi } from '../api/accounting.api';

interface CascadeSelectorProps {
  /** Currently selected category ID (leaf-level) */
  value: string;
  /** Called when a leaf category is selected */
  onChange: (categoryId: string) => void;
  /** 'expense' or 'revenue' */
  type?: 'expense' | 'revenue';
  /** Optional CSS classes */
  className?: string;
  /** Required field? */
  required?: boolean;
  /** Disabled? */
  disabled?: boolean;
}

/**
 * 3-level cascade dropdown for hierarchical categories.
 * Selecting a Category → filters Subcategories → filters Types.
 * Works with both expense_categories and revenue_categories.
 */
export default function CategoryCascadeSelector({
  value,
  onChange,
  type = 'expense',
  className = '',
  required = false,
  disabled = false,
}: CascadeSelectorProps) {
  const { data: allCategories = [] } = useQuery({
    queryKey: [type === 'expense' ? 'expense-categories' : 'revenue-categories'],
    queryFn: () => expenseCategoriesApi.list(),
  });

  const categories = allCategories as Record<string, unknown>[];

  // Organize by level
  const level1 = useMemo(() => categories.filter(c => (c.level as number) === 1), [categories]);
  const level2 = useMemo(() => categories.filter(c => (c.level as number) === 2), [categories]);
  const level3 = useMemo(() => categories.filter(c => (c.level as number) === 3), [categories]);

  // State: selected at each level
  const [selectedL1, setSelectedL1] = useState('');
  const [selectedL2, setSelectedL2] = useState('');

  // Auto-resolve selected levels from the value prop (leaf → find ancestors)
  useEffect(() => {
    if (!value || categories.length === 0) return;
    const leaf = categories.find(c => String(c.id) === value);
    if (!leaf) return;

    const leafLevel = leaf.level as number;
    if (leafLevel === 3) {
      const parent = categories.find(c => String(c.id) === String(leaf.parent_id));
      if (parent) {
        const parentLevel = parent.level as number;
        if (parentLevel === 2) {
          setSelectedL2(String(parent.id));
          setSelectedL1(String(parent.parent_id || ''));
        } else if (parentLevel === 1) {
          // Level 3 directly under level 1 (no subcategory)
          setSelectedL1(String(parent.id));
          setSelectedL2('');
        }
      }
    } else if (leafLevel === 2) {
      setSelectedL1(String(leaf.parent_id || ''));
      setSelectedL2(String(leaf.id));
    } else if (leafLevel === 1) {
      setSelectedL1(String(leaf.id));
      setSelectedL2('');
    }
  }, [value, categories]);

  // Filtered subcategories and types
  const filteredL2 = useMemo(
    () => selectedL1 ? level2.filter(c => String(c.parent_id) === selectedL1) : [],
    [selectedL1, level2]
  );

  const filteredL3 = useMemo(() => {
    if (selectedL2) {
      return level3.filter(c => String(c.parent_id) === selectedL2);
    }
    if (selectedL1) {
      // Types directly under L1 (when no subcategories exist)
      return level3.filter(c => String(c.parent_id) === selectedL1);
    }
    return [];
  }, [selectedL1, selectedL2, level3]);

  // Determine if L1 has direct L3 children (no L2 intermediary)
  const l1HasDirectTypes = useMemo(
    () => selectedL1 ? level3.some(c => String(c.parent_id) === selectedL1) : false,
    [selectedL1, level3]
  );
  const showL2 = filteredL2.length > 0;
  const showL3 = filteredL3.length > 0;

  const selectClass = `w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent ${disabled ? 'opacity-50' : ''}`;

  return (
    <div className={`space-y-2 ${className}`}>
      {/* Level 1: Category */}
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Categorie *</label>
        <select
          value={selectedL1}
          onChange={(e) => {
            setSelectedL1(e.target.value);
            setSelectedL2('');
            onChange('');
          }}
          className={selectClass}
          required={required}
          disabled={disabled}
        >
          <option value="">Choisir une categorie...</option>
          {level1.map(c => (
            <option key={String(c.id)} value={String(c.id)}>
              {String(c.name)}
            </option>
          ))}
        </select>
      </div>

      {/* Level 2: Subcategory (only if L1 has L2 children) */}
      {showL2 && (
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Sous-categorie</label>
          <select
            value={selectedL2}
            onChange={(e) => {
              setSelectedL2(e.target.value);
              onChange('');
            }}
            className={selectClass}
            disabled={disabled}
          >
            <option value="">Toutes les sous-categories</option>
            {filteredL2.map(c => (
              <option key={String(c.id)} value={String(c.id)}>
                {String(c.name)}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Level 3: Type (or direct types if no L2) */}
      {(showL3 || (selectedL1 && l1HasDirectTypes)) && (
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Type *</label>
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={selectClass}
            required={required}
            disabled={disabled}
          >
            <option value="">Choisir un type...</option>
            {filteredL3.map(c => (
              <option key={String(c.id)} value={String(c.id)}>
                {String(c.name)}
                {Boolean(c.requires_po) ? ' (BC requis)' : ''}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
