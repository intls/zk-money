import { formatPercentage_1dp } from 'app/util/formatters';
import { useDefaultExpectedAssetYield } from './defi_info_hooks';
import { DefiRecipe } from './types';

export function useVariableAprText(recipe: DefiRecipe) {
  const expectedYield = useDefaultExpectedAssetYield(recipe);
  if (expectedYield === undefined) return;
  return `Variable: ${formatPercentage_1dp(expectedYield)} APR`;
}
