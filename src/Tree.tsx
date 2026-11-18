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
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import { LocateFixed, Search, Sprout, ArrowUpRight, X } from 'lucide-react';
import { spanishOrder } from './SearchSelect';
import { colors, date, layout, type TreePerson, type Relationship } from './model';
import {
  CARD_WIDTH,
  CARD_HEIGHT,
  branchPeople,
  type FamilyTreeLayout,
  type ConnectionDrawing,
} from './tree-layout';
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
type KinshipData = {
  drawing: ConnectionDrawing;
  partner?: boolean;
  color: string;
  description: string;
};
function KinshipEdge({ data }: EdgeProps<Edge<KinshipData>>) {
  if (!data) return null;
  return (
    <g className={data.partner ? 'kinship-line partner-line' : 'kinship-line family-line'}>
      <title>{data.description}</title>
      {data.drawing.paths.map((part, i) => (
        <path
          key={i}
          d={part.path}
          fill="none"
          stroke={data.color}
          strokeWidth={2}
          strokeDasharray={part.hypothesis ? '6 5' : undefined}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {data.drawing.junction && (
        <circle cx={data.drawing.junction.x} cy={data.drawing.junction.y} r={3} fill={data.color} />
      )}
    </g>
  );
}
const edgeTypes = { kinship: KinshipEdge };
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
  const [branch, setBranch] = useState('all');
  const [graph, setGraph] = useState<FamilyTreeLayout | null>(null);
  const [arranging, setArranging] = useState(true);
  const [layoutError, setLayoutError] = useState('');
  const [locating, setLocating] = useState('');
  const [rootOptions, setRootOptions] = useState<FamilyTreeLayout['roots']>([]);
  const flow = useReactFlow();
  const structureKey = JSON.stringify([
    people.map((p) => [p.id, p.fullName, p.birthDate]).sort(),
    relationships.map((r) => [r.id, r.from, r.to, r.type, r.certainty]).sort(),
    branch,
  ]);
  useEffect(() => {
    let active = true;
    const seeds = rootOptions.find((r) => r.id === branch)?.people;
    const ids = seeds
      ? branchPeople(people, relationships, seeds)
      : new Set(people.map((p) => p.id));
    const branchPersons = people.filter((p) => ids.has(p.id));
    const branchRelations = relationships.filter((r) => ids.has(r.from) && ids.has(r.to));
    setArranging(true);
    setLayoutError('');
    layout(branchPersons, branchRelations)
      .then((result) => {
        if (active) {
          setGraph(result);
          if (branch === 'all') setRootOptions(result.roots);
          setArranging(false);
        }
      })
      .catch(() => {
        if (active) {
          setLayoutError('No se pudo ordenar el árbol. Recargá la página para volver a intentar.');
          setArranging(false);
        }
      });
    return () => {
      active = false;
    };
  }, [structureKey]);
  const nodes = useMemo(
    () =>
      people
        .filter((p) => graph?.positions.has(p.id))
        .map((p) => ({
          id: p.id,
          type: 'person',
          style: { width: CARD_WIDTH, height: CARD_HEIGHT },
          position: graph!.positions.get(p.id)!,
          data: {
            person: p,
            color:
              privateView && 'branch' in p && p.branch
                ? colors[
                    [
                      'Hecht',
                      'Elkin',
                      'Berger',
                      'Feldman',
                      'Bavor',
                      'Pennese',
                      'Posternak',
                      'Bustamante',
                    ].indexOf(p.branch)
                  ]
                : graph!.personColors.get(p.id) || colors[0],
            privateView,
          },
        })),
    [people, graph, privateView],
  );
  const edges = useMemo<Edge<KinshipData>[]>(
    () =>
      (graph?.connections || []).map((c) => ({
        id: c.id,
        source: c.source,
        target: c.target,
        type: 'kinship',
        sourceHandle: c.partner ? 'partner-from' : 'child',
        targetHandle: c.partner ? 'partner-to' : 'parent',
        ariaLabel: c.description,
        data: {
          drawing: c.drawing,
          partner: c.partner,
          color: c.color,
          description: c.description,
        },
      })),
    [graph],
  );
  const fitKey = nodes
    .map((n) => `${n.id}:${n.position.x}:${n.position.y}`)
    .sort()
    .join('|');
  useEffect(() => {
    if (locating) return;
    const timer = setTimeout(() => flow.fitView({ padding: 0.25, maxZoom: 1, duration: 400 }), 100);
    return () => clearTimeout(timer);
  }, [fitKey, flow]);
  const matches = search
    ? people.filter((p) =>
        p.fullName.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es')),
      )
    : [];
  function locate(id: string) {
    setBranch('all');
    setSearch('');
    setLocating(id);
  }
  useEffect(() => {
    if (
      locating &&
      branch === 'all' &&
      !arranging &&
      graph?.positions.size === people.length &&
      graph.positions.has(locating)
    ) {
      void flow.fitView({ nodes: [{ id: locating }], maxZoom: 1.1, duration: 500 });
      setLocating('');
    }
  }, [locating, arranging, graph, flow]);
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
        <label className="branch-picker">
          <span>Ver familia</span>
          <select
            aria-label="Familia o rama del árbol"
            value={branch}
            onChange={(e) => {
              setBranch(e.target.value);
              setSearch('');
            }}
          >
            <option value="all">Árbol completo</option>
            {rootOptions
              .slice()
              .sort((a, b) => spanishOrder.compare(a.label, b.label))
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
          </select>
        </label>
        <button
          className="icon-button center-button"
          title="Centrar árbol"
          aria-label="Centrar árbol"
          onClick={() => flow.fitView({ padding: 0.25, maxZoom: 1, duration: 500 })}
        >
          <LocateFixed size={19} />
        </button>
      </div>
      <div className="tree-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
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
          fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
          minZoom={0.15}
          maxZoom={1.6}
          proOptions={{ hideAttribution: false }}
        >
          <Background color="#d9dfd2" gap={25} size={1} />
          <Controls showInteractive={false} />
          {nodes.length > 8 && <MiniMap pannable zoomable nodeColor="#a5b69b" />}
        </ReactFlow>
        {arranging && people.length > 0 && (
          <div className="layout-progress" role="status">
            Ordenando las ramas familiares…
          </div>
        )}
        {layoutError && (
          <div className="layout-progress error-banner" role="alert">
            {layoutError}
          </div>
        )}
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
        <div
          className={`tree-legend ${nodes.length > 8 ? 'with-minimap' : ''}`}
          aria-label="Referencias de los vínculos"
        >
          <span>
            <i className="legend-couple" /> Pareja
          </span>
          <span>
            <i className="legend-family" /> Padres e hijos
          </span>
        </div>
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
