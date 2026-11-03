import { useState, useEffect, useMemo, useRef } from "react";
import { Analet } from "../../types/analet";
import { runUMAPProjection, UMAPDimensions, UMAPParameters, UMAPProjectionOptions } from "../../utilities/umapProjection";
import { ConstraintService } from "../../services/ConstraintService";
import { fitAndCreateModel, FittedUmapModel, createUMAPJs } from "../../services/umapjs";
export interface UMAPHookOptions {
  dimensions: UMAPDimensions;
  params?: UMAPParameters;
  constraintService?: ConstraintService;
  freezeAfterInitialFit?: boolean; // default true
}

export interface UMAPProjectionResult {
  projectedAnalets: Analet[];
  isProjecting: boolean;
  error: string | undefined;
}

/**
 * Clean UMAP projection hook with constraint support
 */
export function useUMAPProjection(
  analets: Analet[],
  options: UMAPHookOptions
): UMAPProjectionResult {

  const [projectedAnalets, setProjectedAnalets] = useState<Analet[]>([]);
  const [isProjecting, setIsProjecting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [constraintVersion, setConstraintVersion] = useState(0);
  const [configVersion, setConfigVersion] = useState(0);
  const [hasInitialFit, setHasInitialFit] = useState(false);
  // const [lastEmbeddingSig, setLastEmbeddingSig] = useState<string | null>(null);
  const modelRef = useRef<FittedUmapModel | null>(null);
  // Build combined embeddings (text + variables) once per render
  const combinedEmbeddings = useMemo(() => {
    try {
      // Determine embedding dimension D from first available vector
      const sample = analets.find(a => Array.isArray(a.embedding) && (a.embedding?.length || 0) > 0)?.embedding;
      const D = sample?.length || 0;
      if (!D) return new Map<number, number[]>();
      const getAlpha = () => {
        try {
          const raw = window.localStorage.getItem('similarity_alpha');
          const val = raw ? parseFloat(raw) : 0.5;
          return Number.isNaN(val) ? 0.5 : Math.min(1, Math.max(0, val));
        } catch { return 0.5; }
      };
      const alpha = getAlpha();
      const norm = (v: number[]): number[] => {
        let s = 0; for (const x of v) s += x * x; const m = Math.sqrt(s) || 1; return v.map(x => x / m);
      };
      const hash = (s: string): number => {
        let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24); }
        return (h >>> 0) % D;
      };
      const map = new Map<number, number[]>();
      // Debug instrumentation: collect stats if enabled
      const debugEnabled = (() => { try { return localStorage.getItem('debug_similarity') === '1' || localStorage.getItem('debug_umap') === '1'; } catch { return false; } })();
      let withEmbCount = 0;
      let withVarsCount = 0;
      let zeroVarVecCount = 0;
      let avgVarsNNZ = 0;
      const varSetCounter = new Map<string, number>();
      for (const a of analets) {
        const text = Array.isArray(a.embedding) && a.embedding.length === D ? a.embedding.slice() : undefined;
        if (!text) continue;
        const varVec = new Array<number>(D).fill(0);
        const seen = new Set<number>();
        const vars = (a.variables_used || []);
        for (const v of vars) {
          const idx = hash(String(v).toLowerCase());
          if (!seen.has(idx)) { varVec[idx] += 1; seen.add(idx); }
        }
        const textN = norm(text);
        const varsN = norm(varVec);
        const combined = new Array<number>(D);
        for (let i = 0; i < D; i++) combined[i] = alpha * textN[i] + (1 - alpha) * varsN[i];
        map.set(a.id, combined);
        // Update debug stats
        if (debugEnabled) {
          withEmbCount++;
          if (vars.length > 0) withVarsCount++;
          const nnz = varVec.reduce((acc, v) => acc + (v !== 0 ? 1 : 0), 0);
          if (nnz === 0) zeroVarVecCount++;
          avgVarsNNZ += nnz;
          // Count unique variable set signatures (order-insensitive, case-insensitive)
          if (vars.length > 0) {
            const sig = vars.map(x => String(x).toLowerCase()).sort().join('|');
            varSetCounter.set(sig, (varSetCounter.get(sig) || 0) + 1);
          }
        }
      }
      // Emit one consolidated debug log per recompute
      if (debugEnabled) {
        try {
          const uniqueVarSetCount = varSetCounter.size;
          const topVarSets = Array.from(varSetCounter.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
          const avgNNZ = withEmbCount > 0 ? (avgVarsNNZ / withEmbCount) : 0;
          // Note: alpha is the weight on TEXT; variable weight is (1 - alpha)
          console.info('[similarity][combine] alpha(text)=', alpha.toFixed(2), 'varWeight=', (1 - alpha).toFixed(2), {
            D,
            withEmbCount,
            withVarsCount,
            zeroVarVecCount,
            avgVarsNNZ: Number(avgNNZ.toFixed(2)),
            uniqueVarSetCount,
            topVarSets
          });
        } catch {}
      }
      return map;
    } catch {
      return new Map<number, number[]>();
    }
  }, [analets, configVersion]);
  // Create a memoized projection key that changes when inputs change
  const projectionKey = useMemo(() => {
    // Create a stable key based on analet IDs and a shallow hash of their embeddings
    const analetKey = [...analets]
      .sort((a, b) => a.id - b.id)
      .map(a => {
        const len = a.embedding?.length || 0;
        // sample first few dims to detect changes without serializing entire vector
        const s0 = len > 0 ? a.embedding![0].toFixed(4) : '0';
        const s1 = len > 1 ? a.embedding![1].toFixed(4) : '0';
        const s2 = len > 2 ? a.embedding![2].toFixed(4) : '0';
        return `${a.id}:${len}:${s0}:${s1}:${s2}`;
      })
      .join(',');

    // Create a stable options key
    const optionsKey = `${options.dimensions.width}x${options.dimensions.height}p${options.dimensions.padding || 20}`;

    // Include constraint version and config version in the key
    const key = `${analetKey}|${optionsKey}|v${constraintVersion}|c${configVersion}`;
    return key;
  }, [analets, options, constraintVersion, configVersion]);

  // Listen for constraint changes
  useEffect(() => {
    if (options.constraintService) {
      const unsubscribe = options.constraintService.onConstraintsChanged(() => {
        setConstraintVersion(prev => prev + 1);
      });

      return unsubscribe;
    }
  }, [options.constraintService]);

  // Listen for UMAP rerun events
  useEffect(() => {
    const handleRerunUMAP = (_e: Event) => {
      setHasInitialFit(false);
      setConstraintVersion(prev => prev + 1);
      setConfigVersion(prev => prev + 1);
    };

    window.addEventListener('rerunUMAP', handleRerunUMAP as EventListener);

    return () => {
      window.removeEventListener('rerunUMAP', handleRerunUMAP as EventListener);
    };
  }, []);

  // Listen for UMAP config changes
  useEffect(() => {
    const handleConfigChange = (_event: CustomEvent) => {
      setConfigVersion(prev => prev + 1);
    };

    window.addEventListener('umapConfigChanged', handleConfigChange as EventListener);
    return () => {
      window.removeEventListener('umapConfigChanged', handleConfigChange as EventListener);
    };
  }, []);

  // Listen for similarity alpha changes and trigger recompute
  useEffect(() => {
    const handleSimilarityChange = (_event: CustomEvent) => {

      setHasInitialFit(false);
      setConfigVersion(prev => prev + 1);
    };
    window.addEventListener('similarityConfigChanged', handleSimilarityChange as EventListener);
    return () => window.removeEventListener('similarityConfigChanged', handleSimilarityChange as EventListener);
  }, []);

  // Run UMAP projection when dependencies change
  useEffect(() => {
    const runProjection = async () => {
      // Early return for empty analets array to prevent unnecessary processing
      if (!analets || analets.length === 0) {
        setProjectedAnalets([]);
        return;
      }
      // Check if any analets have embeddings
      const analetsWithEmbeddings = analets.filter(a => Array.isArray(a.embedding) && (a.embedding?.length || 0) > 0);
      if (analetsWithEmbeddings.length === 0) {
        setProjectedAnalets(analets); // Return original analets without projection
        return;
      }
      // // Build an embedding signature
      // const embeddingSig = [...analets]
      //   .sort((a, b) => a.id - b.id)
      //   .map(a => {
      //     const len = a.embedding?.length || 0;
      //     const s0 = len > 0 ? a.embedding![0].toFixed(4) : '0';
      //     const s1 = len > 1 ? a.embedding![1].toFixed(4) : '0';
      //     const s2 = len > 2 ? a.embedding![2].toFixed(4) : '0';
      //     return `${a.id}:${len}:${s0}:${s1}:${s2}`;
      //   })
      //   .join(',');
      const freeze = options.freezeAfterInitialFit !== false; // default true
      const haveManyAnalets = analets.length >= 20;
      // const located = analets.filter(a => a.location && typeof a.location.x === 'number' && typeof a.location.y === 'number').length;
      // const locationCoverage = analets.length > 0 ? located / analets.length : 0;
      let forceRefit = false;
      // Skip refit if frozen, initial fit done, and embeddings unchanged
      if (freeze && hasInitialFit) {
        // Preserve cached locations for existing points and project only new points using the persisted model
        const locationById = new Map(projectedAnalets.map(a => [a.id, a.location]));

        // Start with cached positions
        let result = analets.map(a => {
          const cachedLocation = locationById.get(a.id);
          return cachedLocation ? { ...a, location: cachedLocation } : a;
        });
        // Compute out-of-sample transforms for newly added analets (with embeddings)
        const newAnalets = analets.filter(a => !locationById.has(a.id) && Array.isArray(a.embedding) && (a.embedding?.length || 0) > 0);
        if (newAnalets.length === 0) {
          // No new analets to place; apply constraints and commit
          // Apply constraints
          if (options.constraintService) {
            result = result.map(analet => {
              const constraintPosition = options.constraintService!.getConstraintPosition(analet.id);
              if (constraintPosition) {
                return {
                  ...analet,
                  location: {
                    id: analet.location?.id || `analet-${analet.id}`,
                    x: constraintPosition.x,
                    y: constraintPosition.y
                  }
                };
              }
              return analet;
            });
          }
          // Commit if changed
          let identical = result.length === projectedAnalets.length;
          if (identical) {
            const prevById = new Map(projectedAnalets.map(a => [a.id, a]));
            for (const r of result) {
              const prev = prevById.get(r.id);
              if (!prev) { identical = false; break; }
              const rLoc = r.location ? { x: r.location.x, y: r.location.y } : { x: 0, y: 0 };
              const prevLoc = prev.location ? { x: prev.location.x, y: prev.location.y } : { x: 0, y: 0 };
              if (Math.abs((rLoc.x || 0) - (prevLoc.x || 0)) > 0 || Math.abs((rLoc.y || 0) - (prevLoc.y || 0)) > 0) {
                identical = false; break;
              }
              if (r.type !== prev.type || r.source !== prev.source) { identical = false; break; }
            }
          }
          if (!identical) setProjectedAnalets(result);
          return;
        } else {
          // Build map of existing locations and their combined embeddings
          const existing: Array<{ id: number; vec: number[]; x: number; y: number }> = [];
          for (const a of result) {
            const id = (a as any).id as number;
            const loc = (a as any).location;
            if (!loc) continue;
            const base = analets.find(z => z.id === id);
            if (!base) continue;
            const vec = combinedEmbeddings.get(id) || base.embedding;
            if (!vec || !Array.isArray(vec)) continue;
            existing.push({ id, vec: vec as number[], x: loc.x, y: loc.y });
          }
          const cosine = (u: number[], v: number[]) => {
            let dot = 0, nu = 0, nv = 0;
            const L = Math.min(u.length, v.length);
            for (let i = 0; i < L; i++) { const a = u[i]; const b = v[i]; dot += a * b; nu += a * a; nv += b * b; }
            if (nu === 0 || nv === 0) return 0;
            return dot / (Math.sqrt(nu) * Math.sqrt(nv));
          };
          const K = 8;
          for (const a of newAnalets) {
            const vec = (combinedEmbeddings.get(a.id) || a.embedding) as number[] | undefined;
            if (!vec || !Array.isArray(vec)) continue;
            const sims = existing.map(e => ({ e, s: cosine(vec, e.vec) }));
            sims.sort((p, q) => q.s - p.s);
            const top = sims.slice(0, Math.min(K, sims.length));
            let wx = 0, wy = 0, wsum = 0;
            for (const { e, s } of top) {
              const w = Math.max(s, 0.0001); // ensure positive
              wx += w * e.x; wy += w * e.y; wsum += w;
            }
            if (wsum > 0) {
              const x = wx / wsum, y = wy / wsum;
              const idx = result.findIndex(r => (r as any).id === a.id);
              if (idx >= 0) {
                (result as any)[idx] = { ...(result as any)[idx], location: { id: (result as any)[idx].location?.id || `analet-${a.id}`, x, y } };
              } else {
                (result as any).push({ ...a, location: { id: `analet-${a.id}`, x, y } });
              }
            }
          }
          // After KNN placement, continue to constraints + commit path below
        }
        // Apply constraints
        if (options.constraintService) {
          result = result.map(analet => {
            const constraintPosition = options.constraintService!.getConstraintPosition(analet.id);
            if (constraintPosition) {
              return {
                ...analet,
                location: {
                  id: analet.location?.id || `analet-${analet.id}`,
                  x: constraintPosition.x,
                  y: constraintPosition.y
                }
              };
            }
            return analet;
          });
        }
        // Commit if changed
        let identical = result.length === projectedAnalets.length;
        if (identical) {
          const prevById = new Map(projectedAnalets.map(a => [a.id, a]));
          for (const r of result) {
            const prev = prevById.get(r.id);
            if (!prev) { identical = false; break; }
            const rLoc = r.location ? { x: r.location.x, y: r.location.y } : { x: 0, y: 0 };
            const prevLoc = prev.location ? { x: prev.location.x, y: prev.location.y } : { x: 0, y: 0 };
            if (Math.abs((rLoc.x || 0) - (prevLoc.x || 0)) > 0 || Math.abs((rLoc.y || 0) - (prevLoc.y || 0)) > 0) {
              identical = false; break;
            }
            if (r.type !== prev.type || r.source !== prev.source) { identical = false; break; }
          }
        }
        if (!identical) {
          setProjectedAnalets(result);
        }
        return;
      }

      setIsProjecting(true);
      setError(undefined);

      try {
        const projectionOptions: UMAPProjectionOptions = {
          dimensions: options.dimensions,
          params: options.params,
          constraintService: options.constraintService
        };
        // Decide whether to fit
        let results: { x: number; y: number }[] = [] as any;
        let validAnalets: Analet[] = analets;
        const shouldFit = forceRefit || !freeze || !hasInitialFit; // we avoid refit when placing via KNN
        if (shouldFit) {
          // UMAP-JS fit path
          try {
            const withEmb = analets.filter(a => Array.isArray(a.embedding) && (a.embedding?.length || 0) > 0);
            const embeddings = withEmb.map(a => (combinedEmbeddings.get(a.id) || a.embedding!)) as number[][];
            // Debug: verify combined embeddings actually differ from text when varWeight > 0
            try {
              const debugEnabled = (() => { try { return localStorage.getItem('debug_umap') === '1' || localStorage.getItem('debug_similarity') === '1'; } catch { return false; } })();
              if (debugEnabled && withEmb.length > 0) {
                const alphaRaw = (() => { try { return parseFloat(localStorage.getItem('similarity_alpha') || '0.5'); } catch { return 0.5; } })();
                const alpha = Number.isNaN(alphaRaw) ? 0.5 : Math.min(1, Math.max(0, alphaRaw));
                const sample = withEmb.slice(0, 5).map(a => {
                  const text = a.embedding || [];
                  const combo = combinedEmbeddings.get(a.id) || text;
                  let diff = 0, tn = 0, cn = 0;
                  for (let i = 0; i < Math.min(text.length, combo.length); i++) {
                    const d = Math.abs(combo[i] - text[i]);
                    diff += d;
                    tn += Math.abs(text[i]);
                    cn += Math.abs(combo[i]);
                  }
                  return { id: a.id, vars: (a.variables_used || []).slice().sort(), meanAbsDelta: Number((diff / (text.length || 1)).toFixed(6)), textL1: Number(tn.toFixed(2)), comboL1: Number(cn.toFixed(2)) };
                });
                const fallbackUsed = withEmb.filter(a => !combinedEmbeddings.has(a.id)).length;
                console.info('[similarity][umap-fit] using combined embeddings; alpha(text)=', alpha.toFixed(2), 'varWeight=', (1 - alpha).toFixed(2), {
                  n: withEmb.length,
                  fallbackUsed,
                  sample
                });
              }
            } catch {}
            const { width, height, padding = 20 } = options.dimensions;
            const umap = createUMAPJs(options.params);
            const coordMat = umap.fit(embeddings);
            const xs = coordMat.map((p: number[]) => p[0]);
            const ys = coordMat.map((p: number[]) => p[1]);
            const minX = Math.min(...xs);
            const maxX = Math.max(...xs);
            const minY = Math.min(...ys);
            const maxY = Math.max(...ys);
            const targetW = width - 2 * padding;
            const targetH = height - 2 * padding;
            const rangeX = (maxX - minX) || 1;
            const rangeY = (maxY - minY) || 1;
            const scale = Math.min(targetW / rangeX, targetH / rangeY);
            const offsetX = (targetW - (rangeX * scale)) / 2;
            const offsetY = (targetH - (rangeY * scale)) / 2;
            const norm = coordMat.map(([x, y]) => ({
              x: padding + offsetX + ((x - minX) * scale),
              y: padding + offsetY + ((y - minY) * scale)
            }));
            results = norm as any;
            validAnalets = withEmb;
            // Persist model for out-of-sample transforms
            modelRef.current = {
              umap: umap as any,
              bounds: { minX, maxX, minY, maxY, scale, offsetX, offsetY },
              dimensions: { width, height, padding },
              transform: (newEmbeddings: number[][]) => (umap as any).transform(newEmbeddings),
              normalize: (points: number[][]) => points.map((pt: number[]) => {
                const px = pt[0];
                const py = pt[1];
                return {
                  x: padding + offsetX + ((px - minX) * scale),
                  y: padding + offsetY + ((py - minY) * scale)
                };
              }) as any
            } as any;
            } catch (e) {
              // Fallback to utility helpers
              try {
                const { model, results: r, validAnalets: va } = fitAndCreateModel(analets, projectionOptions as any);
                modelRef.current = model;
                results = r as any;
                validAnalets = va;
                try {
                  const debugEnabled = (() => { try { return localStorage.getItem('debug_umap') === '1' || localStorage.getItem('debug_similarity') === '1'; } catch { return false; } })();
                  if (debugEnabled) {
                    console.warn('[similarity][umap-fit] fell back to utility model fit (umapjs service). Note: this path does not mix variables with embeddings.');
                  }
                } catch {}
              } catch {
                const { results: r, validAnalets: va } = runUMAPProjection(analets, projectionOptions);
                results = r as any;
                validAnalets = va;
                try {
                  const debugEnabled = (() => { try { return localStorage.getItem('debug_umap') === '1' || localStorage.getItem('debug_similarity') === '1'; } catch { return false; } })();
                  if (debugEnabled) {
                    console.warn('[similarity][umap-fit] fell back to runUMAPProjection (wrapper). Note: custom wrapper may not mix variables with embeddings.');
                  }
                } catch {}
              }
            }
          } else {
            // Preserve existing positions
            results = validAnalets.map(a => ({ x: a.location?.x || 0, y: a.location?.y || 0 }));
        }
        // Apply projected coordinates to analets
        let movedCount = 0;
        const projectedAnaletsResult = validAnalets.map((analet, index) => {
          const newCoords = results[index];
          const oldCoords = analet.location ? { x: analet.location.x, y: analet.location.y } : { x: 0, y: 0 };

          const projectedAnalet = {
            ...analet,
            location: {
              id: analet.location?.id || `analet-${analet.id}`,
              x: newCoords.x,
              y: newCoords.y
            }
          };

          // Log coordinate changes for debugging layout shifts
          const moved = Math.abs(oldCoords.x - newCoords.x) > 5 || Math.abs(oldCoords.y - newCoords.y) > 5;
          if (moved) movedCount++;

          return projectedAnalet;
        });
        // Avoid useless state updates
        let identical = projectedAnaletsResult.length === projectedAnalets.length;
        if (identical) {
          const idToLoc = new Map(projectedAnalets.map(a => [a.id, a.location ? { x: a.location.x, y: a.location.y } : { x: 0, y: 0 }]));
          for (const r of projectedAnaletsResult) {
            const loc = r.location ? { x: r.location.x, y: r.location.y } : { x: 0, y: 0 };
            const prev = idToLoc.get(r.id) || { x: 0, y: 0 };
            if (Math.abs((loc.x || 0) - (prev.x || 0)) > 0 || Math.abs((loc.y || 0) - (prev.y || 0)) > 0) {
              identical = false;
              break;
            }
          }
        }

        // Debug: Log the projected analets before setting state
        if (!identical) {
          setProjectedAnalets(projectedAnaletsResult);
        }
        // setLastEmbeddingSig(embeddingSig);
        if (freeze && haveManyAnalets) setHasInitialFit(true);


      } catch (projectionError) {
        console.error('[UMAP FIT] ❌ Projection failed:', projectionError);
        setError(String(projectionError));
        setProjectedAnalets(analets); // Return original analets on error
      } finally {
        setIsProjecting(false);
      }
    };

    runProjection();
  }, [projectionKey, analets, options, hasInitialFit]); // Removed projectedAnalets to prevent infinite loop

  return {
    projectedAnalets,
    isProjecting,
    error
  };
}

/**
 * Simplified hook for common use cases with constraint support
 */
export function useSimpleUMAPProjection(
  analets: Analet[],
  width: number = 2000,
  height: number = 1400,
  padding: number = 20,
  constraintService?: ConstraintService
): UMAPProjectionResult {

  try {
    const ids = analets.map(a => a.id);
    // Log only when size or head of ids changes to reduce spam
    (window as any).__lastUMAPIdsSig = (window as any).__lastUMAPIdsSig || '';
    const sig = `${analets.length}:${ids.slice(0,5).join(',')}`;
    if ((window as any).__lastUMAPIdsSig !== sig) {
      (window as any).__lastUMAPIdsSig = sig;
    }
  } catch {}

  const options = useMemo(() => ({
    dimensions: { width, height, padding },
    params: {
      nNeighbors: 5,
      minDist: 0,
      spread: 1,
      nEpochs: 200,
      learningRate: 1.0,
      randomSeed: 42
    },
    constraintService
  }), [width, height, padding, constraintService]);

  return useUMAPProjection(analets, options);
}
