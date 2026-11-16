import { useMemo, useState, useEffect } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  useReactFlow,
  type NodeProps,
  type Node,
  type Connection,
} from '@xyflow/react';
import { LocateFixed, Search, SlidersHorizontal, Sprout, ArrowUpRight, X } from 'lucide-react';
import { colors, date, layout, type TreePerson, type Relationship, type Person } from './model';
type Data = {
  person: TreePerson;
  color: string;
  privateView: boolean;
};
function PersonNode({ data }: NodeProps<Node<Data>>) {
  const p = data.person;
  const privatePerson = 'observations' in p ? p : null;
  return (
    <button
      type="button"
      className="person-node nodrag nopan"
      style={{ '--branch': data.color } as React.CSSProperties}
      aria-label={
        data.privateView ? `Ver y unir a ${p.fullName}` : `Proponer editar datos de ${p.fullName}`
      }
    >
      <Handle type="target" position={Position.Top} id="parent" isConnectable={data.privateView} />
      <Handle
        type="source"
        position={Position.Bottom}
        id="child"
        isConnectable={data.privateView}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="partner-from"
        isConnectable={data.privateView}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="partner-to"
        isConnectable={data.privateView}
      />
      <span className="node-avatar">
        {p.photoData ? (
          <img src={p.photoData} alt={`Foto de ${p.fullName}`} />
        ) : (
          p.fullName
            .split(' ')
            .filter(Boolean)
            .slice(0, 2)
            .map((s) => s[0])
            .join('')
        )}
      </span>
      <span className="node-copy">
        <strong>{p.fullName}</strong>
        <small>{p.birthDate ? `n. ${date(p.birthDate)}` : 'Nacimiento desconocido'}</small>
        {data.privateView && privatePerson?.deceased && (
          <small>
            {privatePerson.deathDate ? date(privatePerson.deathDate) : 'Fallecimiento sin fecha'}
          </small>
        )}
        {data.privateView && privatePerson?.birthPlace && <small>{privatePerson.birthPlace}</small>}
        {data.privateView && privatePerson?.certainty === 'hypothesis' && (
          <small className="hypothesis">Creo que...</small>
        )}
        <small className="node-action-hint">
          {data.privateView ? 'Ver datos y parentescos' : 'Proponer editar datos ↗'}
        </small>
      </span>
    </button>
  );
}
const nodeTypes = { person: PersonNode };
export default function Tree(props: {
  people: TreePerson[];
  relationships: Relationship[];
  privateView: boolean;
  loading: boolean;
  onSelect: (p: TreePerson) => void;
  onAccess: () => void;
  onJoin: (from?: string, to?: string, type?: Relationship['type']) => void;
}) {
  return (
    <ReactFlowProvider>
      <TreeCanvas {...props} />
    </ReactFlowProvider>
  );
}
function TreeCanvas({
  people,
  relationships,
  privateView,
  loading,
  onSelect,
  onAccess,
  onJoin,
}: {
  people: TreePerson[];
  relationships: Relationship[];
  privateView: boolean;
  loading: boolean;
  onSelect: (p: TreePerson) => void;
  onAccess: () => void;
  onJoin: (from?: string, to?: string, type?: Relationship['type']) => void;
}) {
  const [search, setSearch] = useState('');
  const [generation, setGeneration] = useState('all');
  const [filters, setFilters] = useState(false);
  const flow = useReactFlow();
  const graph = useMemo(() => layout(people, relationships), [people, relationships]);
  const nodes = useMemo(
    () =>
      people.map((p) => ({
        id: p.id,
        type: 'person',
        position: graph.positions.get(p.id)!,
        hidden: generation !== 'all' && graph.levels.get(p.id) !== Number(generation),
        data: {
          person: p,
          color:
            colors[
              privateView && 'branch' in p && p.branch
                ? [
                    'Hecht',
                    'Elkin',
                    'Berger',
                    'Feldman',
                    'Bavor',
                    'Pennese',
                    'Posternak',
                    'Bustamante',
                  ].indexOf(p.branch)
                : (graph.components.get(p.id) || 0) % colors.length
            ],
          privateView,
        },
      })),
    [people, graph, privateView, onSelect, generation],
  );
  const edges = useMemo(
    () =>
      relationships
        .filter((r) => people.some((p) => p.id === r.from) && people.some((p) => p.id === r.to))
        .map((r) => ({
          id: r.id,
          source: r.from,
          target: r.to,
          sourceHandle: r.type === 'partner' ? 'partner-from' : 'child',
          targetHandle: r.type === 'partner' ? 'partner-to' : 'parent',
          type: 'smoothstep',
          style: {
            stroke: r.type === 'partner' ? '#bfa886' : '#a7b6a4',
            strokeWidth: 1.5,
            strokeDasharray: r.certainty === 'hypothesis' ? '5 4' : undefined,
          },
          label: privateView && r.certainty === 'hypothesis' ? 'Creo que...' : undefined,
        })),
    [people, relationships, privateView],
  );
  useEffect(() => {
    const timer = setTimeout(() => flow.fitView({ padding: 0.25, duration: 400 }), 100);
    return () => clearTimeout(timer);
  }, [people.length, generation, flow]);
  const matches = search
    ? people.filter((p) =>
        p.fullName.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es')),
      )
    : [];
  function locate(id: string) {
    setGeneration('all');
    setSearch('');
    setTimeout(() => flow.fitView({ nodes: [{ id }], maxZoom: 1.1, duration: 500 }), 100);
  }
  return (
    <>
      <div className="tree-toolbar">
        <div className="search-wrap">
          <Search size={18} />
          <input
            aria-label="Buscar un familiar"
            placeholder="Buscar un familiar por su nombre…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              className="icon-button"
              aria-label="Borrar búsqueda"
              onClick={() => setSearch('')}
            >
              <X size={15} />
            </button>
          )}
          {search && (
            <div className="search-results">
              {matches.length ? (
                matches.map((p) => (
                  <button key={p.id} onClick={() => locate(p.id)}>
                    {p.fullName}
                    <ArrowUpRight size={14} />
                  </button>
                ))
              ) : (
                <p>No encontramos coincidencias.</p>
              )}
            </div>
          )}
        </div>
        <button
          className={`button secondary ${filters ? 'active' : ''}`}
          onClick={() => setFilters(!filters)}
          aria-expanded={filters}
        >
          <SlidersHorizontal size={16} />
          <span>Generaciones</span>
        </button>
        <button
          className="icon-button center-button"
          title="Centrar árbol"
          aria-label="Centrar árbol"
          onClick={() => flow.fitView({ padding: 0.25, duration: 500 })}
        >
          <LocateFixed size={19} />
        </button>
      </div>
      {filters && (
        <div className="filter-bar">
          <label>
            Mostrar{' '}
            <select value={generation} onChange={(e) => setGeneration(e.target.value)}>
              <option value="all">Todas las generaciones</option>
              {graph.generations.map((n) => (
                <option key={n} value={n}>
                  Generación {n + 1}
                </option>
              ))}
            </select>
          </label>
          <span>Los parentescos provienen de vínculos registrados.</span>
        </div>
      )}
      <div className="tree-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={privateView}
          onConnect={(connection: Connection) => {
            if (privateView && connection.source && connection.target)
              onJoin(
                connection.source,
                connection.target,
                connection.sourceHandle?.startsWith('partner') ? 'partner' : undefined,
              );
          }}
          isValidConnection={(connection) => privateView && connection.source !== connection.target}
          onNodeClick={(event, node) => {
            if (!(event.target as Element).closest('.react-flow__handle'))
              onSelect(node.data.person);
          }}
          elementsSelectable={false}
          fitView
          minZoom={0.15}
          maxZoom={1.6}
          proOptions={{ hideAttribution: false }}
        >
          <Background color="#d9dfd2" gap={25} size={1} />
          <Controls showInteractive={false} />
          {people.length > 8 && <MiniMap pannable zoomable nodeColor="#a5b69b" />}
        </ReactFlow>
        {!people.length && (
          <div className="empty-tree">
            <div className="tree-emblem">
              <Sprout size={47} strokeWidth={1.25} />
            </div>
            <span className="eyebrow">CADA HISTORIA EMPIEZA CON UNA RAÍZ</span>
            <h2>{loading ? 'Buscando nuestras raíces…' : 'Una historia por construir'}</h2>
            <p>
              {loading
                ? 'Estamos consultando el árbol publicado.'
                : 'Todavía no hay familiares publicados. Cuando se incorporen y aprueben los primeros datos, nuestro árbol comenzará a crecer acá.'}
            </p>
            {!privateView && !loading && (
              <button className="text-button" onClick={onAccess}>
                Quiero colaborar <ArrowUpRight size={16} />
              </button>
            )}
          </div>
        )}
        <div className="canvas-caption">
          <span className="live-dot" />
          {privateView ? 'Vista del administrador' : 'Vista pública'}
          <span className="caption-separator">·</span>
          {privateView
            ? 'Arrastrá entre conectores para unir familiares'
            : 'Tocá un nodo para proponer cambios'}
        </div>
      </div>
    </>
  );
}
