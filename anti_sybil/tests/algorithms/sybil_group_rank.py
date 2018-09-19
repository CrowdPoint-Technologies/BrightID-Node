import sybil_rank
import networkx as nx
import itertools


class Node():

    def __init__(self, name, node_type, rank=None):
        self.name = name
        self.node_type = node_type
        self.rank = rank
        self.groups = set()

    def __repr__(self):
        return str(self.name)


class SybilGroupRank(sybil_rank.SybilRank):

    def __init__(self, graph, options=None):
        sybil_rank.SybilRank.__init__(self, graph, options)
        groups = {}
        for node in self.graph.nodes():
            for group in node.groups:
                if not group in groups:
                    groups[group] = set()
                groups[group].add(node)
        self.groups = groups
        self.group_graph = self.gen_group_graph()

    def rank(self):
        ranker = sybil_rank.SybilRank(self.group_graph, self.options)
        ranker.rank()
        node_groups_rank = {}
        for group_node in self.group_graph.nodes:
            for node in self.groups[group_node.name]:
                if node not in node_groups_rank:
                    node_groups_rank[node] = []
                node_groups_rank[node].append(group_node.rank)
        for node in self.graph:
            if node in node_groups_rank:
                node.rank = max(node_groups_rank[node])
            else:
                node.rank = 0
                print('{} not in any group!'.format(node))
        return self.group_graph

    def get_group_type(self, group_nodes):
        flag = set([node.node_type for node in group_nodes])
        if flag == set(['Seed']):
            group_type = 'Seed'
        elif flag == set(['Sybil', 'Attacker']):
            group_type = 'Sybil'
        else:
            group_type = 'Honest'
        return group_type

    def gen_group_graph(self):
        weight_dic = {}
        group_graph = nx.Graph()
        groups_dic = dict([(group, Node(group, self.get_group_type(self.groups[group]))) for group in self.groups])
        pairs = itertools.combinations(self.groups.keys(), 2)
        for source_group, target_group in pairs:
            removed = set()
            weight = 0
            for source_node in self.groups[source_group]:
                if source_node in removed:
                    continue
                for target_node in self.groups[target_group]:
                    if source_node in removed:
                        break
                    if target_node in removed:
                        continue
                    if not self.graph.has_edge(source_node, target_node):
                        continue
                    removed.add(source_node)
                    removed.add(target_node)
                    weight += 1
            if weight > 0:
                num = len(self.groups[source_group]) + len(self.groups[target_group])
                group_graph.add_edge(groups_dic[source_group], groups_dic[target_group], weight=1.0*weight/num)
        return group_graph