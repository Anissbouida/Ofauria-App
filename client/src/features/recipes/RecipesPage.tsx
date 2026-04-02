import { useQuery } from '@tanstack/react-query';
import { recipesApi } from '../../api/recipes.api';
import { ChefHat } from 'lucide-react';

export default function RecipesPage() {
  const { data: recipes = [], isLoading } = useQuery({ queryKey: ['recipes'], queryFn: recipesApi.list });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-bakery-chocolate">Recettes</h1>

      {isLoading ? <p className="text-gray-500">Chargement...</p> : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {recipes.map((r: Record<string, unknown>) => (
            <div key={r.id as string} className="card hover:shadow-md transition-shadow">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-primary-100 rounded-lg">
                  <ChefHat size={20} className="text-primary-600" />
                </div>
                <div>
                  <h3 className="font-semibold">{r.name as string}</h3>
                  <p className="text-sm text-gray-500">{r.product_name as string}</p>
                </div>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Rendement: {r.yield_quantity as number}</span>
                <span className="font-semibold text-primary-600">{parseFloat(r.total_cost as string).toFixed(2)} €</span>
              </div>
            </div>
          ))}
          {recipes.length === 0 && <p className="text-gray-400 col-span-full text-center py-8">Aucune recette enregistree</p>}
        </div>
      )}
    </div>
  );
}
